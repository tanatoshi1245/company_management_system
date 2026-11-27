import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';
import { CopyButton } from './CopyButton';
import '../../../styles/ai.css';

export interface DraftPart {
  key: string;
  label: string;
  value: string;
  /** 複数行の欄か（本文・仕事内容など） */
  multiline?: boolean;
  max: number;
}

/**
 * 案（文面・求人票）1 つの表示と手直し。
 * 表示: 項目ごとの文とコピー。「手直し」で欄に変わり、「保存」で onSave（結果と同じ形で確かめるのは呼び出し側。誤りは項目ごとに返す）。
 */
export function DraftEditor({
  parts,
  copyAllText,
  canEdit,
  onSave,
  footer,
}: {
  parts: DraftPart[];
  /** 「すべてコピー」で写す文 */
  copyAllText: string;
  canEdit: boolean;
  /** 直した値（key → 文）を保存する。誤りがあれば「項目 → 文」を返す */
  onSave: (values: Record<string, string>) => Promise<Record<string, string> | null>;
  footer?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const signature = parts.map((p) => `${p.key}=${p.value}`).join('\u0001');
  // 別の案・別の結果に変わったら、手直しをやめる
  useEffect(() => {
    setEditing(false);
    setErrors({});
  }, [signature]);
  const start = () => {
    setValues(Object.fromEntries(parts.map((p) => [p.key, p.value])));
    setErrors({});
    setEditing(true);
  };
  const dirty = editing && parts.some((p) => (values[p.key] ?? '') !== p.value);
  const save = async () => {
    setSaving(true);
    try {
      const errs = await onSave(values);
      if (errs && Object.keys(errs).length) setErrors(errs);
      else setEditing(false);
    } catch (e) {
      setErrors({ _: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="ai-draft">
      <div className="ai-draft-acts">
        {editing ? (
          <>
            <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={save}>
              保存
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              やめる
            </Button>
          </>
        ) : (
          <>
            <CopyButton text={copyAllText} label="すべてコピー" />
            <Button size="sm" disabled={!canEdit} title={canEdit ? undefined : '手直しの保存には Google ログインが必要です'} onClick={start}>
              <Icon name="edit" size={14} /> 手直し
            </Button>
          </>
        )}
      </div>
      {errors._ ? (
        <div className="notice error" role="alert">
          <span>{errors._}</span>
        </div>
      ) : null}
      {parts.map((p) => {
        const v = values[p.key] ?? '';
        return (
          <div key={p.key} className={`ai-draft-part${p.multiline ? ' multi' : ''}`}>
            <div className="head">
              <h3>{p.label}</h3>
              {editing ? (
                <span className={`num small${v.length > p.max ? ' over' : ' muted'}`}>
                  {v.length.toLocaleString('ja-JP')} / {p.max.toLocaleString('ja-JP')} 文字
                </span>
              ) : (
                <CopyButton text={p.value} label={`${p.label}をコピー`} />
              )}
            </div>
            {editing ? (
              p.multiline ? (
                <textarea className="ctl" aria-label={`${p.label}（手直し）`} rows={Math.min(24, Math.max(6, v.split('\n').length + 2))} value={v} disabled={saving} onChange={(e) => setValues((cur) => ({ ...cur, [p.key]: e.target.value }))} />
              ) : (
                <input className="ctl" type="text" aria-label={`${p.label}（手直し）`} value={v} disabled={saving} onChange={(e) => setValues((cur) => ({ ...cur, [p.key]: e.target.value }))} />
              )
            ) : (
              <div className="text" data-part={p.key}>
                {p.value}
              </div>
            )}
            {editing && errors[p.key] ? (
              <div className="err" role="alert">
                {errors[p.key]}
              </div>
            ) : null}
          </div>
        );
      })}
      {footer}
    </div>
  );
}
