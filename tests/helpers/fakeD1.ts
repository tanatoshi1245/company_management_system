import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { D1Like, D1StmtLike } from '../../src/worker/d1/db';

/**
 * D1 の代わり（node:sqlite）。d1/migrations/*.sql を順に適用した :memory: DB。
 * prepare().bind().first/all/run と batch（トランザクション）だけを実装する
 */
const EXEC = Symbol('exec');
type Val = null | number | bigint | string | Uint8Array;
interface FakeStmt extends D1StmtLike {
  [EXEC]: () => { changes: number };
}

function toVal(v: unknown): Val {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string' || v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

export function createFakeD1(migrationsDir = join(process.cwd(), 'd1/migrations')): D1Like & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  const make = (sql: string, values: unknown[]): FakeStmt => {
    const vals = values.map(toVal);
    return {
      bind: (...v: unknown[]) => make(sql, v),
      first: async <T,>() => ((db.prepare(sql).get(...vals) as T | undefined) ?? null),
      all: async <T,>() => ({ results: db.prepare(sql).all(...vals) as T[] }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...vals).changes) } }),
      [EXEC]: () => ({ changes: Number(db.prepare(sql).run(...vals).changes) }),
    };
  };
  return {
    raw: db,
    prepare: (sql: string) => make(sql, []),
    batch: async (stmts: D1StmtLike[]) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => ({ meta: (s as FakeStmt)[EXEC]() }));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
