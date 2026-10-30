import { COMPANY_TABS, type CompanyTab } from '../companyModel';

/** 企業詳細のタブ（求人の実績 / スカウトの実績 / 選考状況）。ヘッダのカードの下に同じ幅で横並び */
export function CompanyTabs({ value, onChange }: { value: CompanyTab; onChange: (t: CompanyTab) => void }) {
  return (
    <nav className="co-tabs" role="tablist" aria-label="企業詳細のタブ">
      {COMPANY_TABS.map((t) => (
        <button key={t.key} type="button" role="tab" id={`co-tab-${t.key}`} aria-selected={value === t.key} aria-controls={`co-panel-${t.key}`} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
