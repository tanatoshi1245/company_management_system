import { useMemo, useState } from 'react';
import type { AiCompanyOption } from '../../../../shared/ai/common';
import { AI_TEXT } from '../../../../shared/ai/options';
import { ComboboxCore } from './Combobox';
import '../../../styles/ai.css';

export const companyHint = (c: AiCompanyOption): string => [c.industry, c.companyType].filter(Boolean).join('・');

/**
 * 既存企業の選択。一覧（ダッシュボードに表示されている企業）にある企業だけ選べる。
 * 名前で絞り込み、同名の区別のために業界・種別を小さく添える。選んだ後は企業名を表示し、× で外せる。
 */
export function CompanyCombobox({ companies, value, onChange, disabled, id }: { companies: AiCompanyOption[]; value: string | null; onChange: (companyId: string | null) => void; disabled?: boolean; id?: string }) {
  const [text, setText] = useState('');
  /** × で外した直後は、入力欄にフォーカスを戻す */
  const [refocus, setRefocus] = useState(false);
  const items = useMemo(() => companies.map((c) => ({ key: c.id, label: c.name, hint: companyHint(c) || undefined })), [companies]);
  const selected = value ? companies.find((c) => c.id === value) ?? null : null;
  if (value) {
    return (
      <div className={`ai-company-picked${disabled ? ' disabled' : ''}`} id={id}>
        <span className="nm">{selected ? selected.name : `企業 ID ${value}`}</span>
        {selected && companyHint(selected) ? <span className="hint">{companyHint(selected)}</span> : null}
        {!selected && companies.length ? <span className="hint">一覧にありません</span> : null}
        <button
          type="button"
          aria-label="企業の選択を外す"
          disabled={disabled}
          onClick={() => {
            setRefocus(true);
            setText('');
            onChange(null);
          }}
        >
          ×
        </button>
      </div>
    );
  }
  return (
    <ComboboxCore
      id={id}
      text={text}
      onText={setText}
      items={items}
      onPick={(it) => {
        setText('');
        setRefocus(false);
        onChange(it.key);
      }}
      onBlur={() => {
        setText('');
        setRefocus(false);
      }}
      placeholder={AI_TEXT.companyPlaceholder}
      disabled={disabled}
      allowFree={false}
      ariaLabel="既存企業を選択"
      autoFocus={refocus}
    />
  );
}
