import { useState } from 'react';
import { fmtMonthShort } from '../../../../shared/calendar/periods';
import { cellOf, GRID_ROWS, isMonthDirty, parseCell, setCell, type GridKey, type GridState } from '../targetsModel';
import { Icon } from '../../../components/ui/Icon';

export function MonthGridForm({ state, onChange, onCopyPrev, disabled, currentMonth }: { state: GridState; onChange: (s: GridState) => void; onCopyPrev: (m: string) => void; disabled: boolean; currentMonth: string }) {
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const idOf = (m: string, k: GridKey) => `${m}|${k}`;
  const commit = (m: string, k: GridKey, raw: string) => {
    const parsed = parseCell(raw, k);
    const id = idOf(m, k);
    const nextInvalid = new Set(invalid);
    if (parsed === 'invalid') nextInvalid.add(id);
    else {
      nextInvalid.delete(id);
      onChange({ ...state, values: { ...state.values, [m]: setCell(state.values[m], k, parsed) } });
    }
    setInvalid(nextInvalid);
    setDrafts((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  };
  return (
    <div className="table-wrap">
      <table className="data compact tgrid" aria-label="月別の目標">
        <thead>
          <tr>
            <th className="sticky-col">指標</th>
            {state.months.map((m, i) => (
              <th key={m} className={`num ${m === currentMonth ? 'cur' : ''} ${isMonthDirty(state, m) ? 'dirty' : ''}`}>
                <div>{fmtMonthShort(m)}</div>
                {i > 0 && !disabled ? (
                  <button type="button" className="btn ghost xs" title="左の月の値を空のセルに写す" aria-label={`${fmtMonthShort(m)} に前月からコピー`} onClick={() => onCopyPrev(m)}>
                    <Icon name="copy" size={14} />
                  </button>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRID_ROWS.map((r, ri) => (
            <tr key={r.key} className={ri > 0 && GRID_ROWS[ri - 1].group !== r.group ? 'group-start' : ''}>
              <th scope="row" className="sticky-col">
                {r.label}
                {ri === 0 || GRID_ROWS[ri - 1].group !== r.group ? <span className="muted small"> {r.group}</span> : null}
              </th>
              {state.months.map((m) => {
                const id = idOf(m, r.key);
                const v = cellOf(state.values[m], r.key);
                const draft = drafts[id];
                return (
                  <td key={m} className={`num ${m === currentMonth ? 'cur' : ''}`}>
                    <input
                      className={`ctl num ${invalid.has(id) ? 'invalid' : ''} ${isMonthDirty(state, m) ? 'dirty' : ''}`}
                      inputMode="numeric"
                      aria-label={`${fmtMonthShort(m)} ${r.label}`}
                      aria-invalid={invalid.has(id) || undefined}
                      disabled={disabled}
                      value={draft ?? (v === null ? '' : String(v))}
                      onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                      onBlur={(e) => commit(m, r.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="group-start">
            <th scope="row" className="sticky-col">備考</th>
            {state.months.map((m) => (
              <td key={m} className={m === currentMonth ? 'cur' : ''}>
                <input className={`ctl note ${isMonthDirty(state, m) ? 'dirty' : ''}`} aria-label={`${fmtMonthShort(m)} 備考`} maxLength={500} disabled={disabled} value={state.notes[m] ?? ''} onChange={(e) => onChange({ ...state, notes: { ...state.notes, [m]: e.target.value } })} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {invalid.size ? (
        <p className="small" role="alert" style={{ color: 'var(--heat-n2)' }}>
          0 以上の整数で入力してください（赤枠のセル）。保存は赤枠が無くなってから
        </p>
      ) : null}
    </div>
  );
}
