import type { ReactNode } from 'react';
import '../../../styles/ai.css';

/** 入力欄 1 つ（ラベル・欄・補足・誤りの文）。誤りは欄の下に出す */
export function AiField({ label, htmlFor, required, hint, error, wide, children }: { label: string; htmlFor?: string; required?: boolean; hint?: ReactNode; error?: string | null; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`ai-field${wide ? ' wide' : ''}${error ? ' has-error' : ''}`}>
      <div className="lbl">
        <label htmlFor={htmlFor}>{label}</label>
        {required ? <span className="req">必須</span> : null}
      </div>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** 文字数（上限つき）。上限を超えたら赤 */
export function CharCount({ value, max }: { value: string; max: number }) {
  const n = value.length;
  return (
    <span className={`num${n > max ? ' over' : ''}`}>
      {n.toLocaleString('ja-JP')} / {max.toLocaleString('ja-JP')} 文字
    </span>
  );
}
