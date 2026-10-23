import { describe, expect, it } from 'vitest';
import { businessDaysBetween, businessDaysInMonth, holidayYearsCovered, isBusinessDay, monthProgress, nextBusinessDay } from '../../src/shared/calendar/businessDays';
import { todayJst } from '../../src/shared/calendar/periods';

describe('営業日（土日・祝日・年末年始を除く）', () => {
  it('祝日データは当年と翌年を含む（12 月に落ちたら jp-holidays.json を更新する）', () => {
    const y = Number(todayJst().slice(0, 4));
    const years = holidayYearsCovered();
    expect(years).toContain(y);
    expect(years).toContain(y + 1);
  });
  it('個別の日', () => {
    expect(isBusinessDay('2026-10-23')).toBe(true); // 金
    expect(isBusinessDay('2026-10-24')).toBe(false); // 土
    expect(isBusinessDay('2026-10-12')).toBe(false); // スポーツの日
    expect(isBusinessDay('2026-05-06')).toBe(false); // 振替休日
    expect(isBusinessDay('2026-09-22')).toBe(false); // 国民の休日
    expect(isBusinessDay('2026-12-29')).toBe(false); // 会社の年末休業
    expect(isBusinessDay('2027-01-04')).toBe(true);
    expect(isBusinessDay('2027-03-22')).toBe(false); // 春分の振替
  });
  it('月の営業日数と進捗', () => {
    expect(businessDaysInMonth('2026-10')).toBe(21); // 22 平日 − スポーツの日
    expect(businessDaysInMonth('2026-05')).toBe(18); // 21 平日 − 4/29…5/6 のうち平日 3 日（5/4,5/5,5/6）
    expect(businessDaysInMonth('2026-12')).toBe(20); // 23 平日 − 12/29,30,31
    expect(businessDaysBetween('2026-10-01', '2026-10-22')).toBe(15);
    expect(monthProgress('2026-10', '2026-10-22')).toEqual({ total: 21, elapsed: 15, rate: 15 / 21 });
    expect(monthProgress('2026-10', '2026-09-30')).toEqual({ total: 21, elapsed: 0, rate: 0 });
    expect(monthProgress('2026-09', '2026-10-05')).toEqual({ total: 19, elapsed: 19, rate: 1 });
    expect(businessDaysBetween('2026-10-10', '2026-10-01')).toBe(0);
  });
  it('年跨ぎ・翌営業日', () => {
    expect(businessDaysBetween('2026-12-28', '2027-01-05')).toBe(3); // 12/28(月), 1/4(月), 1/5(火)。12/29〜1/3 は休業・祝日・土日
    expect(nextBusinessDay('2026-12-26')).toBe('2026-12-28');
    expect(nextBusinessDay('2026-12-28')).toBe('2027-01-04');
  });
});
