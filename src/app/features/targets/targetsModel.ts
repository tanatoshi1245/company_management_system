import { EMPTY_TARGETS, hasAnyTarget, sameTargets, STAGE_TARGET_KEYS, STAGE_TARGET_LABEL, TARGET_METRIC_LABEL, TARGET_METRICS, type PlanDefaultValues, type StageTargetKey, type TargetMetric, type TargetRecord, type TargetValues, planDefaultsToTargets } from '../../../shared/schema/targets';
import { addMonths } from '../../../shared/calendar/periods';

export type GridKey = TargetMetric | `stage.${StageTargetKey}`;
export interface GridRow {
  key: GridKey;
  label: string;
  group: '実績' | '選考段階';
}
export const GRID_ROWS: GridRow[] = [
  ...TARGET_METRICS.map((k): GridRow => ({ key: k, label: TARGET_METRIC_LABEL[k], group: '実績' })),
  ...STAGE_TARGET_KEYS.map((k): GridRow => ({ key: `stage.${k}`, label: STAGE_TARGET_LABEL[k], group: '選考段階' })),
];

/** フォームの列: from の前月から 12 か月 */
export const GRID_MONTHS = 12;
export function gridMonths(from: string): string[] {
  return Array.from({ length: GRID_MONTHS }, (_, i) => addMonths(from, i - 1));
}

export interface GridState {
  months: string[];
  values: Record<string, TargetValues>;
  notes: Record<string, string>;
  original: Record<string, TargetRecord | null>;
}

export function fromRecords(months: string[], rows: TargetRecord[]): GridState {
  const by = new Map(rows.map((r) => [r.month, r]));
  const values: Record<string, TargetValues> = {};
  const notes: Record<string, string> = {};
  const original: Record<string, TargetRecord | null> = {};
  for (const m of months) {
    const r = by.get(m) ?? null;
    original[m] = r;
    values[m] = r ? { ...r.values, stages: { ...r.values.stages } } : { ...EMPTY_TARGETS, stages: {} };
    notes[m] = r?.note ?? '';
  }
  return { months, values, notes, original };
}

export function cellOf(v: TargetValues, key: GridKey): number | null {
  if (key.startsWith('stage.')) return v.stages?.[key.slice(6) as StageTargetKey] ?? null;
  return v[key as TargetMetric] ?? null;
}

export function setCell(v: TargetValues, key: GridKey, n: number | null): TargetValues {
  if (key.startsWith('stage.')) {
    const stages = { ...v.stages };
    const k = key.slice(6) as StageTargetKey;
    if (n === null) delete stages[k];
    else stages[k] = n;
    return { ...v, stages };
  }
  return { ...v, [key]: n };
}

/** 入力文字列 → 数値。空 = null、整数以外・負数・上限超過は invalid */
export const CELL_MAX: Record<GridKey, number> = { scout_sent: 1_000_000, interested: 1_000_000, applications: 1_000_000, views: 10_000_000, hires: 100_000, 'stage.screening': 100_000, 'stage.interview': 100_000, 'stage.offer': 100_000 };
export function parseCell(s: string, key: GridKey): number | null | 'invalid' {
  const t = s.replace(/[,\s]/g, '').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'invalid';
  const n = Number(t);
  if (n > CELL_MAX[key]) return 'invalid';
  return n;
}

export function isMonthDirty(s: GridState, m: string): boolean {
  const o = s.original[m];
  const origValues = o?.values ?? EMPTY_TARGETS;
  const origNote = o?.note ?? '';
  return !sameTargets(s.values[m], origValues) || (s.notes[m] ?? '') !== origNote;
}

export interface GridDiff {
  puts: { month: string; values: TargetValues; note: string | null }[];
  deletes: string[];
}

/** 差分のある月だけ PUT / DELETE にする（空になった月は削除） */
export function diffGrid(s: GridState): GridDiff {
  const puts: GridDiff['puts'] = [];
  const deletes: string[] = [];
  for (const m of s.months) {
    if (!isMonthDirty(s, m)) continue;
    const v = s.values[m];
    const note = (s.notes[m] ?? '').trim() || null;
    if (hasAnyTarget(v) || note) puts.push({ month: m, values: v, note });
    else if (s.original[m]) deletes.push(m);
  }
  return { puts, deletes };
}

/** 前の列の値を、空のセルにだけ写す */
export function copyFromPrevious(s: GridState, m: string): GridState {
  const i = s.months.indexOf(m);
  if (i <= 0) return s;
  const src = s.values[s.months[i - 1]];
  let v = s.values[m];
  for (const r of GRID_ROWS) if (cellOf(v, r.key) === null && cellOf(src, r.key) !== null) v = setCell(v, r.key, cellOf(src, r.key));
  const notes = { ...s.notes };
  if (!notes[m]) notes[m] = s.notes[s.months[i - 1]] ?? '';
  return { ...s, values: { ...s.values, [m]: v }, notes };
}

/** プラン既定値を、空のセルにだけ写す（全列） */
export function applyPlanDefaults(s: GridState, def: PlanDefaultValues): GridState {
  const dv = planDefaultsToTargets(def);
  const values = { ...s.values };
  for (const m of s.months) {
    let v = values[m];
    for (const r of GRID_ROWS) if (cellOf(v, r.key) === null && cellOf(dv, r.key) !== null) v = setCell(v, r.key, cellOf(dv, r.key));
    values[m] = v;
  }
  return { ...s, values };
}

export function dirtyMonths(s: GridState): string[] {
  return s.months.filter((m) => isMonthDirty(s, m));
}
