/**
 * AI 機能のセッションが BigQuery を読む（決まった SQL だけ）。
 *   npm run ai:sql -- <機能>/<名前> --param key=value … [--out <file>] [--dry]
 *   npm run ai:sql -- --list
 * - 実行できるのは ai/<機能>/sql/<名前>.sql だけ（ディレクトリにあるファイル名と一致するもの）
 * - 渡せるのは、SQL の先頭で宣言したパラメータだけ（@param で渡す。SQL の文字は変えない）
 * - 必ず先に dry run し、宣言した上限（-- max_bytes）を超えたら実行しない
 * - SELECT 以外を含む SQL は実行しない
 * 結果は JSON（{ sql, bytesProcessed, rowCount, rows }）。個人名を含みうるので、--out はリポジトリの外へ。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBqClient, ensureProxyEnv } from './bq';
import { UsageError, assertParamsDeclared, assertSelectOnly, buildParams, checkOutPath, fmtBytes, listSqlNames, one, parseArgs, parseSqlHeader, resolveSqlFile } from './lib';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AI_ROOT = join(REPO, 'ai');

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ['dry', 'list']);
  if (args.flags.has('list')) {
    for (const n of listSqlNames(AI_ROOT)) {
      const h = parseSqlHeader(readFileSync(resolveSqlFile(n, AI_ROOT), 'utf8'));
      console.log(`${n}  (上限 ${fmtBytes(h.maxBytes)})`);
      for (const p of h.params) console.log(`    ${p.name} ${p.type} ${p.required ? '必須' : `既定 ${p.type === 'ARRAY<STRING>' ? '（空）' : (p.def ?? 'NULL')}`}${p.min !== undefined ? ` ${p.min}〜${p.max ?? ''}` : ''}`);
    }
    return;
  }
  if (args.positional.length !== 1) throw new UsageError('使い方: npm run ai:sql -- <機能>/<名前> --param key=value … [--out <file>] [--dry]');
  const name = args.positional[0];
  const unknown = Object.keys(args.options).filter((k) => k !== 'param' && k !== 'out');
  if (unknown.length) throw new UsageError(`使えない引数です: --${unknown.join(', --')}`);

  const sql = readFileSync(resolveSqlFile(name, AI_ROOT), 'utf8');
  const header = parseSqlHeader(sql);
  assertSelectOnly(sql);
  assertParamsDeclared(sql, header);
  const params = buildParams(header, args.options.param ?? []);
  const outRaw = one(args, 'out');
  const out = outRaw ? checkOutPath(outRaw, REPO) : null;

  const client = await createBqClient();
  const q = { label: `ai_${name.replace('/', '_')}`, sql, params, maxBytes: header.maxBytes };
  const dry = await client.dryRun(q);
  console.error(`dry run: ${fmtBytes(dry.bytesProcessed)}（上限 ${fmtBytes(header.maxBytes)}）`);
  if (dry.bytesProcessed > header.maxBytes) {
    console.error('上限を超えるので実行しません');
    process.exit(3);
  }
  if (args.flags.has('dry')) return;

  const started = Date.now();
  const res = await client.run(q);
  const payload = JSON.stringify({ sql: name, bytesProcessed: res.bytesProcessed, cacheHit: res.cacheHit, rowCount: res.rows.length, rows: res.rows }, null, 1);
  console.error(`実行: ${res.rows.length} 行・${fmtBytes(res.bytesProcessed)}・${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  if (out) {
    writeFileSync(out, payload, { mode: 0o600 });
    console.error(`結果を書きました: ${out}`);
  } else {
    console.log(payload);
  }
}

ensureProxyEnv();
main().catch((e: unknown) => {
  console.error(e instanceof UsageError ? e.message : `失敗: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
