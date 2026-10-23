// 複製元: sales_dashboard_IS-FS_ver2 の src/app/lib/format.ts。変更点: 比率・日数・簡略表記を追加、金額系を削除。
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return Math.round(n).toLocaleString('ja-JP');
}

/** 0.812 → "81%"。digits で小数桁 */
export function fmtRate(r: number | null | undefined, digits = 0): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '–';
  return `${(r * 100).toFixed(digits)}%`;
}

/** 分子 / 分母 → "81%" */
export function fmtPct(num: number, den: number, digits = 0): string {
  if (!den) return '–';
  return fmtRate(num / den, digits);
}

/** 1.17 → "1.17×" */
export function fmtRatio(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '–';
  return `${r.toFixed(2)}×`;
}

/** 小数 1 桁（0.5 → "0.5"、12 → "12"） */
export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return Number.isInteger(n) ? n.toLocaleString('ja-JP') : n.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** 12345 → "1.2万"（狭い場所用） */
export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億`;
  if (a >= 10_000) return `${(n / 10_000).toFixed(a >= 100_000 ? 0 : 1)}万`;
  return Math.round(n).toLocaleString('ja-JP');
}

/** YYYY-MM-DD → M/D */
export function fmtMd(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const [, m, d] = ymd.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** YYYY-MM-DD → YYYY/M/D */
export function fmtYmd(ymd: string | null | undefined): string {
  if (!ymd) return '–';
  const [y, m, d] = ymd.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

/** "3 日前" / "今日" / "1 日前"。null は "記録なし" */
export function fmtDaysAgo(ymd: string | null | undefined, today: string): string {
  if (!ymd) return '記録なし';
  const d = daysBetween(ymd, today);
  if (d <= 0) return '今日';
  if (d === 1) return '昨日';
  return `${d} 日前`;
}

/** 残り日数の表示: "残 45 日" / "終了" / "無期限" */
export function fmtDaysLeft(days: number | null | undefined): string {
  if (days === null || days === undefined) return '無期限';
  if (days < 0) return `終了 ${-days} 日前`;
  if (days === 0) return '本日終了';
  return `残 ${days} 日`;
}
