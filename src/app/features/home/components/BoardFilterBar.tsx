import { useEffect, useState } from 'react';
import type { BoardColumn, BoardFilters, EndingDays } from '../../../../shared/metrics/board';
import { ENDING_OPTIONS } from '../../../../shared/metrics/board';
import { COMPANY_TYPES, COMPANY_TYPE_SHORT } from '../../../../shared/labels';
import { fmtMonthJa } from '../../../../shared/calendar/periods';
import { Chip } from '../../../components/ui/Chip';
import { Segmented } from '../../../components/ui/Segmented';
import { Icon } from '../../../components/ui/Icon';

export interface SortOption {
  key: string;
  label: string;
}

export function sortOptions(columns: BoardColumn[]): SortOption[] {
  return [
    { key: 'name', label: '企業名' },
    { key: 'type', label: '種別' },
    { key: 'owner', label: 'CS 担当' },
    { key: 'pace', label: 'スカウトのペース（遅い順）' },
    { key: 'contractEnd', label: '契約終了が近い順' },
    { key: 'login', label: 'ログインが古い順' },
    ...columns.filter((c) => !['login', 'daysToEnd'].includes(c.key)).map((c) => ({ key: `-${c.key}`, label: `${c.label}（多い順）` })),
  ];
}

interface Props {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  month: string;
  months: string[];
  onMonth: (m: string) => void;
  sort: string;
  onSort: (s: string) => void;
  sorts: SortOption[];
  owners: { key: string; label: string; name: string; count: number }[];
  industries: { key: string; count: number }[];
  types: { key: string; count: number }[];
  mineCount: number;
  activeCount: number;
  onClear: () => void;
}

/** 固定のフィルタ行。すべての絞り込みはここだけ。状態は URL に保持される */
export function BoardFilterBar(p: Props) {
  const [q, setQ] = useState(p.filters.q);
  useEffect(() => setQ(p.filters.q), [p.filters.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== p.filters.q) p.onChange({ q });
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const typeCount = new Map(p.types.map((t) => [t.key, t.count]));
  return (
    <div className="sticky-bar" role="search" aria-label="絞り込み">
      <Chip label="担当 = 自分" on={p.filters.mine} onClick={() => p.onChange({ mine: !p.filters.mine })} count={p.mineCount} disabled={p.mineCount === 0 && !p.filters.mine} title={p.mineCount === 0 ? 'ログイン中のメールが担当になっている企業がありません（設定で担当を上書きできます）' : '自分が担当の企業だけ'} icon={<Icon name="filter" size={14} />} />
      <details className="industry-pick owner-pick">
        <summary>
          <span className={`chip ${p.filters.owner.length ? 'on' : ''}`} aria-label="CS 担当で絞り込み">
            CS 担当{p.filters.owner.length ? ` ${p.filters.owner.length}` : ''}
            <Icon name="chevronDown" size={14} />
          </span>
        </summary>
        <div className="industry-pop" role="group" aria-label="CS 担当">
          {p.owners.map((o) => (
            <label key={o.key} title={o.name}>
              <input type="checkbox" checked={p.filters.owner.includes(o.key)} onChange={(e) => p.onChange({ owner: e.target.checked ? [...p.filters.owner, o.key] : p.filters.owner.filter((x) => x !== o.key) })} />
              <span>{o.label}</span>
              <span className="cnt">{o.count}</span>
            </label>
          ))}
        </div>
      </details>
      <details className="industry-pick">
        <summary>
          <span className={`chip ${p.filters.industry.length ? 'on' : ''}`}>
            業種{p.filters.industry.length ? ` ${p.filters.industry.length}` : ''}
            <Icon name="chevronDown" size={14} />
          </span>
        </summary>
        <div className="industry-pop">
          {p.industries.map((i) => (
            <label key={i.key}>
              <input
                type="checkbox"
                checked={p.filters.industry.includes(i.key)}
                onChange={(e) => p.onChange({ industry: e.target.checked ? [...p.filters.industry, i.key] : p.filters.industry.filter((x) => x !== i.key) })}
              />
              <span>{i.key}</span>
              <span className="cnt">{i.count}</span>
            </label>
          ))}
        </div>
      </details>
      <div className="chip-group" role="group" aria-label="企業種別">
        {COMPANY_TYPES.filter((t) => t !== '不明' || typeCount.get(t)).map((t) => (
          <Chip key={t} label={COMPANY_TYPE_SHORT[t]} on={p.filters.type.includes(t)} count={typeCount.get(t) ?? 0} onClick={() => p.onChange({ type: p.filters.type.includes(t) ? p.filters.type.filter((x) => x !== t) : [...p.filters.type, t] })} />
        ))}
      </div>
      <div className="field">
        <label htmlFor="f-ending">契約終了</label>
        <Segmented<string>
          ariaLabel="契約終了までの日数"
          options={[{ key: '', label: 'すべて' }, ...ENDING_OPTIONS.map((d) => ({ key: String(d), label: `${d} 日以内` }))]}
          value={p.filters.ending === null ? '' : String(p.filters.ending)}
          onChange={(v) => p.onChange({ ending: v ? (Number(v) as EndingDays) : null })}
        />
      </div>
      <input id="f-q" type="search" className="ctl" placeholder="企業名で検索" aria-label="企業名で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      <span className="spacer" />
      <div className="field">
        <label htmlFor="f-month">期間</label>
        <select id="f-month" className="ctl" value={p.month} onChange={(e) => p.onMonth(e.target.value)}>
          {[...p.months].reverse().map((m, i) => (
            <option key={m} value={m}>
              {i === 0 ? `今月（${fmtMonthJa(m)}）` : i === 1 ? `先月（${fmtMonthJa(m)}）` : fmtMonthJa(m)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-sort">並べ替え</label>
        <select id="f-sort" className="ctl" value={p.sort} onChange={(e) => p.onSort(e.target.value)}>
          {p.sorts.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {p.activeCount > 0 ? (
        <button type="button" className="btn ghost sm" onClick={p.onClear}>
          <Icon name="close" size={14} /> クリア（{p.activeCount}）
        </button>
      ) : null}
    </div>
  );
}
