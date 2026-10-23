export interface SegmentedOption<T extends string> {
  key: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

/** 排他的な選択（期間・モード・種別）。選ばれた項目は紺の塗り */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.key} type="button" className={o.key === value ? 'on' : ''} aria-pressed={o.key === value} title={o.title} disabled={o.disabled} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
