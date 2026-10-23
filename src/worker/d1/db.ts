/**
 * D1 の最小インターフェース（workers-types に依存せずテストで差し替えるため）。
 * 本番は env.CMS_DB（D1Database）をそのまま渡す。すべて prepare().bind() を通す（SQL インジェクション対策）
 */
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1StmtLike;
  batch(stmts: D1StmtLike[]): Promise<unknown[]>;
}

export const nowIso = (): string => new Date().toISOString();

export function asD1(db: unknown): D1Like {
  return db as D1Like;
}
