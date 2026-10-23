import holidaysJson from './jp-holidays.json';
import { addDays, eachDay, endOfMonth, isWeekendDay, todayJst } from './periods';

/**
 * 営業日 = 月〜金 のうち、祝日（jp-holidays.json）と会社の休業日（年末年始 12/29〜1/3。companyClosed）を除いた日。
 * 祝日は年 1 回 `npm run holidays:update`（または手で）追加する。当年と翌年が無いとテストが落ちる。
 */
interface HolidayFile {
  version: string;
  holidays: Record<string, string[]>;
  companyClosed: string[];
}
const FILE = holidaysJson as HolidayFile;
const HOLIDAYS: ReadonlySet<string> = new Set(Object.values(FILE.holidays).flat());
const CLOSED: ReadonlySet<string> = new Set(FILE.companyClosed);

export const HOLIDAYS_VERSION = FILE.version;

export function holidayYearsCovered(): number[] {
  return Object.keys(FILE.holidays)
    .map(Number)
    .sort((a, b) => a - b);
}

export function isHoliday(ymd: string): boolean {
  return HOLIDAYS.has(ymd);
}

export function isCompanyClosed(ymd: string): boolean {
  return CLOSED.has(ymd.slice(5));
}

export function isBusinessDay(ymd: string): boolean {
  return !isWeekendDay(ymd) && !isHoliday(ymd) && !isCompanyClosed(ymd);
}

/** start〜end（両端含む）の営業日数。end < start は 0 */
export function businessDaysBetween(start: string, end: string): number {
  if (end < start) return 0;
  return eachDay(start, end).filter(isBusinessDay).length;
}

export function businessDaysInMonth(ym: string): number {
  return businessDaysBetween(`${ym}-01`, endOfMonth(`${ym}-01`));
}

export interface MonthProgress {
  /** 当月の営業日数 */
  total: number;
  /** asOf（含む）までに経過した営業日数。asOf が月より前なら 0、後なら total */
  elapsed: number;
  /** 営業日消化率 = elapsed / total（0〜1） */
  rate: number;
}

/**
 * 営業日消化率。asOf = イベントデータの最終日（data_date。通常は昨日）。
 * ペース比較の分母なので「今日」ではなく「データが揃っている日」まで数える
 */
export function monthProgress(ym: string, asOf: string): MonthProgress {
  const total = businessDaysInMonth(ym);
  const first = `${ym}-01`;
  const last = endOfMonth(first);
  let elapsed: number;
  if (asOf < first) elapsed = 0;
  else if (asOf >= last) elapsed = total;
  else elapsed = businessDaysBetween(first, asOf);
  return { total, elapsed, rate: total ? elapsed / total : 0 };
}

/** 翌営業日（当日が営業日でも翌日以降） */
export function nextBusinessDay(ymd: string): string {
  let d = addDays(ymd, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

export function todayBusinessContext(now: Date = new Date()): { today: string; isBusinessDay: boolean } {
  const today = todayJst(now);
  return { today, isBusinessDay: isBusinessDay(today) };
}
