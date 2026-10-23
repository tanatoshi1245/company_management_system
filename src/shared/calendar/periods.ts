// 複製元: sales_dashboard_IS-FS_ver2 の src/shared/periods.ts。変更点: 期間プリセット・取得窓・チャンク分割を削除し、月（YYYY-MM）の関数を追加。
/** 日付ユーティリティ（すべて JST・YYYY-MM-DD / YYYY-MM の文字列で扱う） */

export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 表示用の JST 日時 "YYYY-MM-DD HH:MM" */
export function nowJstDisplay(now: Date = new Date()): string {
  const s = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

/** ISO 文字列（UTC）→ JST の "YYYY-MM-DD HH:MM"。解釈できなければ null */
export function isoToJstDisplay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // BQ の CAST(TIMESTAMP AS STRING) は "2026-10-23 10:22:08.190506+00"（オフセット 2 桁）。":00" を補って ISO にする
  const s = iso.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const t = Date.parse(s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  if (Number.isNaN(t)) return null;
  return nowJstDisplay(new Date(t));
}

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** 月曜始まりの週の初日 */
export function startOfWeek(ymd: string): string {
  const d = toUtc(ymd);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
}

export function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function endOfMonth(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return fromUtc(new Date(Date.UTC(y, m, 0)));
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(s: string | null | undefined): s is string {
  return Boolean(s && YMD.test(s) && !Number.isNaN(toUtc(s).getTime()) && fromUtc(toUtc(s)) === s);
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isYm(s: string | null | undefined): s is string {
  return Boolean(s && YM.test(s));
}

/** YYYY-MM-DD → YYYY-MM */
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/** YYYY-MM の n か月後（負で前） */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** 古い順に n か月（endYm を含む） */
export function lastNMonths(endYm: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(endYm, -i));
  return out;
}

/** start〜end に含まれる月（YYYY-MM-01）を古い順に返す */
export function eachMonthStart(start: string, end: string): string[] {
  const out: string[] = [];
  let m = startOfMonth(start);
  while (m <= end) {
    out.push(m);
    m = addDays(endOfMonth(m), 1);
  }
  return out;
}

/** "2026-10" → "2026年10月" */
export function fmtMonthJa(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}

/** "2026-10" → "10月"（1 月だけ年を付ける） */
export function fmtMonthShort(ym: string): string {
  const [y, m] = ym.split('-');
  return Number(m) === 1 ? `${y}年1月` : `${Number(m)}月`;
}

export function isWeekendDay(ymd: string): boolean {
  const d = toUtc(ymd).getUTCDay();
  return d === 0 || d === 6;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}
