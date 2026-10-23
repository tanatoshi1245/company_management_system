import type { ReactNode } from 'react';

/** トグル式の絞り込みチップ（担当=自分 など） */
export function Chip({ label, on, onClick, count, disabled, title, icon }: { label: string; on: boolean; onClick: () => void; count?: number; disabled?: boolean; title?: string; icon?: ReactNode }) {
  return (
    <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick} disabled={disabled} title={title}>
      {icon}
      {label}
      {count !== undefined ? <span className="cnt">{count}</span> : null}
    </button>
  );
}
