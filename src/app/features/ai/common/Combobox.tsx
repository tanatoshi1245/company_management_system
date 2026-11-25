import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AI_COMBOBOX_LIMIT, AI_TEXT } from '../../../../shared/ai/options';
import '../../../styles/ai.css';

/** 絞り込みの照合（全角・半角、大文字・小文字、空白の違いを無視する） */
export const normalizeOption = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export interface ComboItem {
  key: string;
  label: string;
  /** 小さく添える説明（同名の区別など）。絞り込みの対象にもなる */
  hint?: string;
}

interface CoreProps {
  id?: string;
  text: string;
  onText: (v: string) => void;
  items: ComboItem[];
  onPick: (item: ComboItem) => void;
  /** 候補を選ばずに Enter を押したとき（自由入力の確定） */
  onEnterFree?: (text: string) => void;
  onBlur?: () => void;
  onBackspaceEmpty?: () => void;
  placeholder?: string;
  disabled?: boolean;
  allowFree: boolean;
  ariaLabel?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}

/**
 * 「テキストの予測変換 + プルダウン」の本体（WAI-ARIA の combobox）。
 * 入力で絞り込み、↑↓ で移動、Enter で選択、Esc で閉じる。▼ で全件を開く。候補は AI_COMBOBOX_LIMIT 件まで出す。
 * Combobox（文字の一覧）・TagCombobox（複数）・CompanyCombobox（企業）・求人の選択が、この部品を使う。
 */
export function ComboboxCore({ id, text, onText, items, onPick, onEnterFree, onBlur, onBackspaceEmpty, placeholder, disabled, allowFree, ariaLabel, invalid, autoFocus }: CoreProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  /** ▼ で開いたとき = 入力に関係なく全件を出す */
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(-1);

  const matched = useMemo(() => {
    const q = normalizeOption(text);
    if (showAll || !q) return items;
    return items.filter((it) => normalizeOption(it.label).includes(q) || (it.hint ? normalizeOption(it.hint).includes(q) : false));
  }, [items, text, showAll]);
  const shown = matched.length > AI_COMBOBOX_LIMIT ? matched.slice(0, AI_COMBOBOX_LIMIT) : matched;
  const rest = matched.length - shown.length;
  const expanded = open && !disabled && (shown.length > 0 || !allowFree);

  useEffect(() => {
    if (active >= shown.length) setActive(shown.length ? 0 : -1);
  }, [active, shown.length]);
  useEffect(() => {
    if (!expanded || active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, expanded]);

  const close = () => {
    setOpen(false);
    setShowAll(false);
    setActive(-1);
  };
  const pick = (it: ComboItem) => {
    onPick(it);
    close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!expanded) {
        setOpen(true);
        // 入力が候補とぴったり同じ（選んだ後）なら、全件から選び直せるようにする
        if (items.some((it) => it.label === text)) setShowAll(true);
        setActive(e.key === 'ArrowDown' ? 0 : -1);
        return;
      }
      if (!shown.length) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % shown.length : a <= 0 ? shown.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      if (expanded && active >= 0 && shown[active]) {
        e.preventDefault();
        pick(shown[active]);
        return;
      }
      const exact = matched.find((it) => normalizeOption(it.label) === normalizeOption(text));
      const only = !allowFree && text.trim() && matched.length === 1 ? matched[0] : undefined;
      if (exact ?? only) {
        e.preventDefault();
        pick((exact ?? only)!);
      } else if (allowFree && onEnterFree && text.trim()) {
        e.preventDefault();
        onEnterFree(text);
        close();
      } else if (expanded) {
        e.preventDefault();
        if (allowFree) close();
      }
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === 'Backspace' && !text && onBackspaceEmpty) {
      onBackspaceEmpty();
    }
  };

  return (
    <div className={`ai-combo${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}>
      <input
        ref={inputRef}
        id={inputId}
        className="ctl ai-combo-input"
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          onText(e.target.value);
          setShowAll(false);
          setOpen(true);
          setActive(-1);
        }}
        onClick={() => {
          if (open) return;
          setOpen(true);
          if (items.some((it) => it.label === text)) setShowAll(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          onBlur?.();
        }}
      />
      <button
        type="button"
        className="ai-combo-toggle"
        tabIndex={-1}
        aria-label={expanded ? '候補を閉じる' : '候補を開く'}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (expanded) close();
          else {
            setOpen(true);
            setShowAll(true);
            setActive(-1);
            inputRef.current?.focus();
          }
        }}
      >
        ▼
      </button>
      <ul id={listId} ref={listRef} className="ai-combo-list" role="listbox" aria-label={ariaLabel ? `${ariaLabel}の候補` : '候補'} hidden={!expanded} onMouseDown={(e) => e.preventDefault()}>
        {expanded
          ? shown.map((it, i) => (
              <li key={it.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(it)}>
                <span className="lbl">{it.label}</span>
                {it.hint ? <span className="hint">{it.hint}</span> : null}
              </li>
            ))
          : null}
        {expanded && shown.length === 0 ? (
          <li role="presentation" className="note">
            {AI_TEXT.noOptions}
          </li>
        ) : null}
        {expanded && rest > 0 ? (
          <li role="presentation" className="note">
            {AI_TEXT.moreOptions}（{matched.length} 件中 {shown.length} 件を表示）
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export interface ComboboxProps {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  /** 既定 true: 一覧に無い文字も入れられる。false のときは、候補を選んだときだけ onChange を呼ぶ（消したら ''） */
  allowFree?: boolean;
  ariaLabel?: string;
  /** 入力の誤り（枠を赤くする） */
  invalid?: boolean;
}

/** 汎用の「テキストの予測変換 + プルダウン」。options は文字の一覧 */
export function Combobox({ id, value, onChange, options, placeholder, disabled, allowFree = true, ariaLabel, invalid }: ComboboxProps): ReactNode {
  const items = useMemo(() => Array.from(new Set(options)).map((o) => ({ key: o, label: o })), [options]);
  // allowFree = false のとき: 打っている途中の文字は手元に持ち、候補を選んだときだけ親へ伝える
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const text = allowFree ? value : draft;
  return (
    <ComboboxCore
      id={id}
      text={text}
      onText={(v) => {
        if (allowFree) onChange(v);
        else {
          setDraft(v);
          if (v === '' && value !== '') onChange('');
        }
      }}
      items={items}
      onPick={(it) => {
        setDraft(it.label);
        onChange(it.label);
      }}
      onBlur={allowFree ? undefined : () => setDraft(value)}
      placeholder={placeholder}
      disabled={disabled}
      allowFree={allowFree}
      ariaLabel={ariaLabel}
      invalid={invalid}
    />
  );
}
