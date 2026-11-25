/**
 * AI 機能のセッションが使う道具（scripts/ai/*.ts）で共有する、外へ出ない部分（判定と組み立て）。
 * ここにはネットワーク・鍵の扱いを書かない（tests/repo/aiSql.test.ts が単体で検査する）。
 *   - 宛先の制限 … Worker の /hook/ai/jobs/<id>/{context,result} だけ
 *   - SQL の制限 … ai/<機能>/sql/<名前>.sql だけ・SELECT だけ・宣言したパラメータだけ
 */
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { QueryParameter } from '../../src/worker/bq/params';

export class UsageError extends Error {}

// ───────────── 引数 ─────────────

export interface Args {
  positional: string[];
  /** --key value（同じ key は並べた順に溜める） */
  options: Record<string, string[]>;
  flags: Set<string>;
}

/** `--key value` と `--flag` を読む。flagNames に挙げた名前だけが値を取らない */
export function parseArgs(argv: readonly string[], flagNames: readonly string[] = []): Args {
  const out: Args = { positional: [], options: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out.positional.push(a);
      continue;
    }
    const key = a.slice(2);
    if (flagNames.includes(key)) {
      out.flags.add(key);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined) throw new UsageError(`--${key} の値がありません`);
    (out.options[key] ??= []).push(v);
    i++;
  }
  return out;
}

export function one(args: Args, key: string): string | undefined {
  const v = args.options[key];
  if (!v) return undefined;
  if (v.length > 1) throw new UsageError(`--${key} は 1 回だけ指定してください`);
  return v[0];
}

// ───────────── 宛先（Worker の hook）─────────────

export type HookKind = 'context' | 'result';
const HOOK_PATH = /^\/hook\/ai\/jobs\/([a-z0-9]{16,40})\/(context|result)$/;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

/**
 * 合言葉を送ってよい宛先か。通すのは次の形だけ:
 *   https://<何か>.workers.dev/hook/ai/jobs/<jobId>/<context|result>
 *   http://127.0.0.1[:port]/…・http://localhost[:port]/…（手元での確認用）
 * クエリ・ハッシュ・ユーザー名・ポート（本番）は不可。
 */
export function checkHookUrl(raw: string, kind: HookKind): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UsageError('URL として読めません');
  }
  if (u.username || u.password) throw new UsageError('URL にユーザー名・パスワードを入れないでください');
  if (u.search || u.hash) throw new UsageError('URL にクエリ・ハッシュを付けないでください');
  const local = LOCAL_HOSTS.includes(u.hostname);
  if (local) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UsageError('http / https だけです');
  } else {
    if (u.protocol !== 'https:') throw new UsageError('https だけです');
    if (u.port) throw new UsageError('ポートは指定できません');
    if (!/^[a-z0-9][a-z0-9.-]*\.workers\.dev$/.test(u.hostname)) throw new UsageError('宛先は *.workers.dev だけです');
  }
  const m = HOOK_PATH.exec(u.pathname);
  if (!m) throw new UsageError('パスは /hook/ai/jobs/<jobId>/context か /result だけです');
  if (m[2] !== kind) throw new UsageError(`この道具が使うのは /${kind} の URL です`);
  return u;
}

/** 合言葉の形（Worker が発行する乱数。空白・改行・引用符を含まない） */
export function checkToken(raw: string | undefined): string {
  if (!raw) throw new UsageError('--token（合言葉）がありません');
  if (!/^[A-Za-z0-9._~+/=-]{16,512}$/.test(raw)) throw new UsageError('合言葉の形が違います');
  return raw;
}

// ───────────── 出力先 ─────────────

/** --out はリポジトリの外だけ（セッションはリポジトリのファイルを変えない） */
export function checkOutPath(raw: string, repoRoot: string): string {
  const abs = resolve(raw);
  const rel = relative(resolve(repoRoot), abs);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new UsageError('--out はリポジトリの外（/tmp など）を指定してください');
  return abs;
}

// ───────────── SQL ファイル ─────────────

export const SQL_FEATURES = ['scout', 'job', 'report'] as const;
const SQL_NAME = /^(scout|job|report)\/([a-z0-9_]{1,60})$/;

/** `<機能>/<名前>` → ai/<機能>/sql/<名前>.sql。ディレクトリに実在するファイル名と一致するものだけ */
export function resolveSqlFile(name: string, aiRoot: string): string {
  const m = SQL_NAME.exec(name);
  if (!m) throw new UsageError('SQL は <機能>/<名前>（例 scout/peer_templates）で指定してください');
  const dir = join(aiRoot, m[1], 'sql');
  const file = `${m[2]}.sql`;
  const allowed = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')) : [];
  if (!allowed.includes(file)) throw new UsageError(`ai/${m[1]}/sql/ に ${file} はありません（あるもの: ${allowed.join(', ') || 'なし'}）`);
  return join(dir, file);
}

export function listSqlNames(aiRoot: string): string[] {
  const out: string[] = [];
  for (const f of SQL_FEATURES) {
    const dir = join(aiRoot, f, 'sql');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) if (file.endsWith('.sql')) out.push(`${f}/${file.slice(0, -4)}`);
  }
  return out;
}

export type ParamType = 'INT64' | 'STRING' | 'BOOL' | 'ARRAY<STRING>';
export interface ParamDecl {
  name: string;
  type: ParamType;
  required: boolean;
  /** 既定値（required でないとき）。null = NULL を渡す。ARRAY の既定は空 */
  def: string | null;
  min?: number;
  max?: number;
}
export interface SqlHeader {
  params: ParamDecl[];
  maxBytes: number;
}

/** どの SQL でも超えられない上限（宣言がこれより大きければ読み込みで止める） */
export const HARD_MAX_BYTES = 30 * 1024 ** 3;
export const STRING_PARAM_MAX = 200;
export const ARRAY_PARAM_MAX = 10;

const UNIT: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

/**
 * 先頭のコメントの宣言を読む。
 *   -- param: <名前> <INT64|STRING|BOOL|ARRAY<STRING>> <required | default=<値> | nullable> [min=<n>] [max=<n>]
 *   -- max_bytes: <数><MB|GB>
 */
export function parseSqlHeader(sql: string): SqlHeader {
  const params: ParamDecl[] = [];
  let maxBytes: number | null = null;
  for (const line of sql.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('--')) {
      if (t === '') continue;
      break; // 宣言は、最初の SQL の行より前だけ
    }
    const body = t.replace(/^--\s*/, '');
    const mb = /^max_bytes:\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\s*$/i.exec(body);
    if (mb) {
      if (maxBytes !== null) throw new UsageError('max_bytes の宣言が 2 つあります');
      maxBytes = Math.round(Number(mb[1]) * UNIT[mb[2].toUpperCase()]);
      continue;
    }
    if (!/^param:/.test(body)) continue;
    const mp = /^param:\s*([a-z][a-z0-9_]*)\s+(INT64|STRING|BOOL|ARRAY<STRING>)\s+(.*)$/.exec(body);
    if (!mp) throw new UsageError(`param の宣言が読めません: ${body}`);
    const d: ParamDecl = { name: mp[1], type: mp[2] as ParamType, required: false, def: null };
    let mode = false;
    for (const tok of mp[3].trim().split(/\s+/)) {
      if (tok === 'required') {
        d.required = true;
        mode = true;
      } else if (tok === 'nullable') {
        d.def = null;
        mode = true;
      } else if (tok.startsWith('default=')) {
        d.def = tok.slice(8);
        mode = true;
      } else if (/^min=-?\d+$/.test(tok)) d.min = Number(tok.slice(4));
      else if (/^max=-?\d+$/.test(tok)) d.max = Number(tok.slice(4));
      else throw new UsageError(`param ${d.name} の宣言に読めない語があります: ${tok}`);
    }
    if (!mode) throw new UsageError(`param ${d.name} に required / default= / nullable のどれかを書いてください`);
    if (params.some((x) => x.name === d.name)) throw new UsageError(`param ${d.name} の宣言が 2 つあります`);
    params.push(d);
  }
  if (maxBytes === null) throw new UsageError('max_bytes の宣言がありません');
  if (maxBytes <= 0 || maxBytes > HARD_MAX_BYTES) throw new UsageError('max_bytes が大きすぎます（上限 30GB）');
  return { params, maxBytes };
}

/** コメントと文字列の中身を落とした SQL（語の検査用。文字列は '' に置き換える） */
export function stripSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--' || c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      const triple = sql.slice(i, i + 3) === c.repeat(3);
      const q = triple ? c.repeat(3) : c;
      const raw = /[rR]$/.test(out) || /[rR][bB]$|[bB][rR]$/.test(out);
      i += q.length;
      while (i < sql.length && sql.slice(i, i + q.length) !== q) {
        if (!raw && sql[i] === '\\') i++;
        i++;
      }
      i += q.length;
      out += "''";
    } else if (c === '`') {
      const end = sql.indexOf('`', i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const FORBIDDEN = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'EXPORT', 'LOAD', 'CALL', 'EXECUTE', 'DECLARE', 'SET', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'GRANT', 'REVOKE', 'ASSERT', 'RAISE', 'INTO',
];
const TABLE_REF = /`([^`]*)`/g;

/** SELECT 1 本だけか（書き込み・スクリプト・複数文を通さない）。読むのは bq-hgt.dwh の表だけ */
export function assertSelectOnly(sql: string): void {
  const body = stripSql(sql).trim().replace(/;\s*$/, '');
  if (body.includes(';')) throw new UsageError('SQL は 1 文だけです（; で区切らない）');
  if (!/^(WITH|SELECT)\b/i.test(body)) throw new UsageError('SQL は WITH / SELECT で始めてください');
  for (const w of FORBIDDEN) {
    if (new RegExp(`(?<![A-Za-z0-9_@.\`])${w}(?![A-Za-z0-9_])`, 'i').test(body.replace(TABLE_REF, ' '))) throw new UsageError(`SQL に使えない語があります: ${w}`);
  }
  for (const m of body.matchAll(TABLE_REF)) {
    if (!/^bq-hgt\.dwh\.[A-Za-z0-9_]+$/.test(m[1])) throw new UsageError(`読めるのは bq-hgt.dwh の表だけです: ${m[1]}`);
  }
}

/** 本文で使っている @param の名前（重複なし・出てきた順） */
export function usedParams(sql: string): string[] {
  const out: string[] = [];
  for (const m of stripSql(sql).matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** 宣言と本文の @param が一致しているか */
export function assertParamsDeclared(sql: string, header: SqlHeader): void {
  const used = usedParams(sql);
  const declared = header.params.map((p) => p.name);
  const undeclared = used.filter((n) => !declared.includes(n));
  const unused = declared.filter((n) => !used.includes(n));
  if (undeclared.length) throw new UsageError(`宣言の無い @param があります: ${undeclared.join(', ')}`);
  if (unused.length) throw new UsageError(`宣言したのに使っていない param があります: ${unused.join(', ')}`);
}

/** `--param key=value` を、宣言と突き合わせて BigQuery のパラメータにする。宣言に無い名前・型の違う値は通さない */
export function buildParams(header: SqlHeader, given: readonly string[]): QueryParameter[] {
  const values = new Map<string, string[]>();
  for (const g of given) {
    const eq = g.indexOf('=');
    if (eq <= 0) throw new UsageError(`--param は key=value で書いてください: ${g.slice(0, 40)}`);
    const k = g.slice(0, eq);
    if (!header.params.some((p) => p.name === k)) throw new UsageError(`この SQL に無いパラメータです: ${k}（あるもの: ${header.params.map((p) => p.name).join(', ')}）`);
    values.set(k, [...(values.get(k) ?? []), g.slice(eq + 1)]);
  }
  return header.params.map((d) => {
    const vs = values.get(d.name);
    if (d.type === 'ARRAY<STRING>') {
      const arr = (vs ?? []).map((v) => v.trim()).filter((v) => v !== '');
      if (d.required && arr.length === 0) throw new UsageError(`${d.name} は必須です`);
      if (arr.length > ARRAY_PARAM_MAX) throw new UsageError(`${d.name} は ${ARRAY_PARAM_MAX} 個までです`);
      for (const v of arr) checkString(d.name, v);
      return { name: d.name, parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: arr.map((value) => ({ value })) } };
    }
    if (vs && vs.length > 1) throw new UsageError(`${d.name} は 1 回だけ指定してください`);
    let raw: string | null = vs ? vs[0] : null;
    if (raw === null) {
      if (d.required) throw new UsageError(`${d.name} は必須です`);
      raw = d.def === null || d.def === 'NULL' ? null : d.def;
    }
    if (raw === null) return { name: d.name, parameterType: { type: d.type }, parameterValue: { value: null } };
    if (d.type === 'INT64') {
      if (!/^-?\d{1,15}$/.test(raw)) throw new UsageError(`${d.name} は整数で指定してください`);
      const n = Number(raw);
      if (d.min !== undefined && n < d.min) throw new UsageError(`${d.name} は ${d.min} 以上です`);
      if (d.max !== undefined && n > d.max) throw new UsageError(`${d.name} は ${d.max} 以下です`);
      return { name: d.name, parameterType: { type: 'INT64' }, parameterValue: { value: String(n) } };
    }
    if (d.type === 'BOOL') {
      if (raw !== 'true' && raw !== 'false') throw new UsageError(`${d.name} は true / false で指定してください`);
      return { name: d.name, parameterType: { type: 'BOOL' }, parameterValue: { value: raw } };
    }
    checkString(d.name, raw);
    return { name: d.name, parameterType: { type: 'STRING' }, parameterValue: { value: raw } };
  });
}

function checkString(name: string, v: string): void {
  if (v.length > STRING_PARAM_MAX) throw new UsageError(`${name} は ${STRING_PARAM_MAX} 文字までです`);
  if (/[\u0000-\u001f]/.test(v)) throw new UsageError(`${name} に制御文字は使えません`);
}

// ───────────── 結果の文字（個人情報の確認用）─────────────

/** JSON の中の文字列を、場所つきで全部取り出す */
export function collectStrings(v: unknown, path = ''): { path: string; text: string }[] {
  if (typeof v === 'string') return [{ path, text: v }];
  if (Array.isArray(v)) return v.flatMap((x, i) => collectStrings(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => collectStrings(x, path ? `${path}.${k}` : k));
  return [];
}

export const fmtBytes = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
