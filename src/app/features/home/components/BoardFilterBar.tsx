import { useEffect, useRef, useState } from 'react';
import type { BoardFilters, EndingFilter, YesNo } from '../../../../shared/metrics/board';
import { ENDING_LABEL, ENDING_OPTIONS, YES_NO_LABEL } from '../../../../shared/metrics/board';
import { COMPANY_TYPES, COMPANY_TYPE_SHORT } from '../../../../shared/labels';
import { Chip } from '../../../components/ui/Chip';
import { Icon } from '../../../components/ui/Icon';

interface Props {
  filters: BoardFilters;
  onChange: (patch: Partial<BoardFilters>) => void;
  owners: { key: string; label: string; name: string; count: number }[];
  types: { key: string; count: number }[];
  mineCount: number;
  activeCount: number;
  onClear: () => void;
}

/** 複数選択のプルダウン（チェックボックス付き）。外側のクリック・Esc で閉じる。スカウト未利用の登録ページでも使う */
export function MultiPick({ label, ariaLabel, options, value, onChange }: { label: string; ariaLabel: string; options: { key: string; label: string; title?: string; count: number }[]; value: string[]; onChange: (v: string[]) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current) ref.current.open = false;
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <details className="industry-pick" ref={ref} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className={`chip ${value.length ? 'on' : ''}`} aria-label={`${ariaLabel}で絞り込み`}>
          {label}
          {value.length ? ` ${value.length}` : ''}
          <Icon name="chevronDown" size={14} />
        </span>
      </summary>
      <div className="industry-pop" role="group" aria-label={ariaLabel}>
        {options.map((o) => (
          <label key={o.key} title={o.title}>
            <input type="checkbox" checked={value.includes(o.key)} onChange={(e) => onChange(e.target.checked ? [...value, o.key] : value.filter((x) => x !== o.key))} />
            <span>{o.label}</span>
            <span className="cnt">{o.count}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

/** 固定のフィルタ行（契約中の企業が対象）。担当=自分・CS 担当・企業種別・契約終了・検索。状態は URL に保持される */
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
  const typeOptions = COMPANY_TYPES.filter((t) => t !== '不明' || typeCount.get(t)).map((t) => ({ key: t, label: COMPANY_TYPE_SHORT[t], count: typeCount.get(t) ?? 0 }));
  return (
    <div className="sticky-bar" role="search" aria-label="絞り込み">
      <Chip label="担当 = 自分" on={p.filters.mine} onClick={() => p.onChange({ mine: !p.filters.mine })} count={p.mineCount} disabled={p.mineCount === 0 && !p.filters.mine} title={p.mineCount === 0 ? 'ログイン中のメールが担当になっている企業がありません（設定で担当を上書きできます）' : '自分が担当の企業だけ'} icon={<Icon name="filter" size={14} />} />
      <MultiPick label="CS 担当" ariaLabel="CS 担当" options={p.owners.map((o) => ({ key: o.key, label: o.label, title: o.name, count: o.count }))} value={p.filters.owner} onChange={(owner) => p.onChange({ owner })} />
      <MultiPick label="企業種別" ariaLabel="企業種別" options={typeOptions} value={p.filters.type} onChange={(type) => p.onChange({ type })} />
      <div className="field">
        <label htmlFor="f-ending">契約終了</label>
        <select id="f-ending" className="ctl" value={p.filters.ending ?? ''} onChange={(e) => p.onChange({ ending: (e.target.value || null) as EndingFilter | null })}>
          <option value="">すべて</option>
          {ENDING_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {ENDING_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-jobs">求人掲載</label>
        <select id="f-jobs" className="ctl" value={p.filters.jobs ?? ''} onChange={(e) => p.onChange({ jobs: (e.target.value || null) as YesNo | null })}>
          <option value="">すべて</option>
          <option value="yes">{YES_NO_LABEL.yes}</option>
          <option value="no">{YES_NO_LABEL.no}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-sent">スカウト送信</label>
        <select id="f-sent" className="ctl" value={p.filters.sent ?? ''} onChange={(e) => p.onChange({ sent: (e.target.value || null) as YesNo | null })}>
          <option value="">すべて</option>
          <option value="yes">{YES_NO_LABEL.yes}</option>
          <option value="no">{YES_NO_LABEL.no}</option>
        </select>
      </div>
      <input id="f-q" type="search" className="ctl" placeholder="企業名で検索" aria-label="企業名で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      <span className="spacer" />
      {p.activeCount > 0 ? (
        <button type="button" className="btn ghost sm" onClick={p.onClear}>
          <Icon name="close" size={14} /> クリア（{p.activeCount}）
        </button>
      ) : null}
    </div>
  );
}
