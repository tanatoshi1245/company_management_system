import { useMemo, useState } from 'react';
import { ComboboxCore, normalizeOption } from './Combobox';
import '../../../styles/ai.css';

export interface TagComboboxProps {
  id?: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
  max: number;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  invalid?: boolean;
}

/**
 * 複数を選ぶ「テキストの予測変換 + プルダウン」（掲載職種を 1〜5 個など）。
 * 選んだものはチップで並び、× で外す。一覧に無い文字も、Enter か欄の外へ出たときに足される。
 */
export function TagCombobox({ id, values, onChange, options, max, placeholder, disabled, ariaLabel, invalid }: TagComboboxProps) {
  const [text, setText] = useState('');
  const items = useMemo(() => {
    const taken = new Set(values.map(normalizeOption));
    return Array.from(new Set(options))
      .filter((o) => !taken.has(normalizeOption(o)))
      .map((o) => ({ key: o, label: o }));
  }, [options, values]);
  const full = values.length >= max;
  const add = (raw: string) => {
    const v = raw.trim();
    setText('');
    if (!v || full) return;
    if (values.some((x) => normalizeOption(x) === normalizeOption(v))) return;
    onChange([...values, v]);
  };
  return (
    <div className="ai-tags" role="group" aria-label={ariaLabel}>
      {values.length ? (
        <ul className="ai-tag-list">
          {values.map((v) => (
            <li key={v} className="ai-tag">
              <span>{v}</span>
              <button type="button" aria-label={`${v} を外す`} disabled={disabled} onClick={() => onChange(values.filter((x) => x !== v))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ComboboxCore
        id={id}
        text={text}
        onText={setText}
        items={items}
        onPick={(it) => add(it.label)}
        onEnterFree={add}
        onBlur={() => add(text)}
        onBackspaceEmpty={() => (values.length ? onChange(values.slice(0, -1)) : undefined)}
        placeholder={full ? `${max} 個まで` : placeholder}
        disabled={disabled || full}
        allowFree
        ariaLabel={ariaLabel ? `${ariaLabel}を足す` : undefined}
        invalid={invalid}
      />
    </div>
  );
}
