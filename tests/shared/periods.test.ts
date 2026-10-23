import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, eachMonthStart, endOfMonth, fmtMonthJa, fmtMonthShort, isoToJstDisplay, isYm, isYmd, lastNMonths, monthOf, startOfMonth, startOfWeek, todayJst } from '../../src/shared/calendar/periods';

describe('日付ユーティリティ', () => {
  it('JST の今日', () => {
    expect(todayJst(new Date('2026-10-22T15:30:00Z'))).toBe('2026-10-23');
    expect(todayJst(new Date('2026-10-22T14:59:00Z'))).toBe('2026-10-22');
    expect(isoToJstDisplay('2026-10-22T22:52:10Z')).toBe('2026-10-23 07:52');
    expect(isoToJstDisplay('2026-10-22 22:52:10')).toBe('2026-10-23 07:52');
    expect(isoToJstDisplay('2026-10-23 10:22:08.190506+00')).toBe('2026-10-23 19:22');
    expect(isoToJstDisplay('2026-10-23 10:22:08+09:00')).toBe('2026-10-23 10:22');
    expect(isoToJstDisplay(null)).toBeNull();
  });
  it('日・週・月', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
    expect(startOfMonth('2026-10-25')).toBe('2026-10-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(diffDays('2026-10-01', '2026-10-23')).toBe(22);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-10-23')).toBe(true);
    expect(isYm('2026-13')).toBe(false);
    expect(isYm('2026-10')).toBe(true);
    expect(monthOf('2026-10-23')).toBe('2026-10');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', 3)).toBe('2027-01');
    expect(lastNMonths('2026-10', 3)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(eachMonthStart('2026-09-15', '2026-11-02')).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(fmtMonthJa('2026-10')).toBe('2026年10月');
    expect(fmtMonthShort('2026-01')).toBe('2026年1月');
    expect(fmtMonthShort('2026-10')).toBe('10月');
  });
});
