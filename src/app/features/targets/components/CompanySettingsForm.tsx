import { useEffect, useState } from 'react';
import type { CompanySettings } from '../../../../shared/schema/company';
import { apiSend } from '../../../lib/api';
import { invalidate } from '../../../lib/useResource';
import { Button } from '../../../components/ui/Button';
import { Help } from '../../../components/ui/Help';
import { fmtInt } from '../../../lib/format';
import { isoToJstDisplay } from '../../../../shared/calendar/periods';

interface Form {
  csOwnerEmail: string;
  csOwnerName: string;
  scoutLimitPeriod: 'month' | 'contract';
  scoutLimitOverride: string;
  jobLimitOverride: string;
  memo: string;
}
const fromRecord = (s: CompanySettings | null): Form => ({ csOwnerEmail: s?.csOwnerEmail ?? '', csOwnerName: s?.csOwnerName ?? '', scoutLimitPeriod: s?.scoutLimitPeriod ?? 'month', scoutLimitOverride: s?.scoutLimitOverride === null || s?.scoutLimitOverride === undefined ? '' : String(s.scoutLimitOverride), jobLimitOverride: s?.jobLimitOverride === null || s?.jobLimitOverride === undefined ? '' : String(s.jobLimitOverride), memo: s?.memo ?? '' });

/** 企業設定: 担当の上書き・スカウト枠の期間・枠の上書き・メモ（D1 company_settings） */
export function CompanySettingsForm({ companyId, settings, defaults, canEdit, onSaved }: { companyId: string; settings: CompanySettings | null; defaults: { ownerName: string | null; ownerSrc: string; scoutLimit: number | null; jobLimit: number | null }; canEdit: boolean; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(() => fromRecord(settings));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => setForm(fromRecord(settings)), [settings]);
  const num = (s: string): number | null | 'invalid' => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : 'invalid');
  const save = async () => {
    const so = num(form.scoutLimitOverride);
    const jo = num(form.jobLimitOverride);
    if (so === 'invalid' || jo === 'invalid') {
      setMsg({ tone: 'err', text: '枠の上書きは 0 以上の整数で入力してください' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await apiSend('PUT', `/api/companies/${companyId}/settings`, { csOwnerEmail: form.csOwnerEmail.trim() || null, csOwnerName: form.csOwnerName.trim() || null, scoutLimitPeriod: form.scoutLimitPeriod, scoutLimitOverride: so, jobLimitOverride: jo, memo: form.memo.trim() || null });
      invalidate('/api/companies/');
      invalidate('/api/board');
      invalidate('/api/me');
      invalidate('/api/settings/');
      setMsg({ tone: 'ok', text: '保存しました' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="card" id="settings">
      <div className="card-head">
        <h2>
          企業の設定 <Help text="担当 CS を Salesforce の所有者から上書きする、スカウト枠を契約期間の累計で見る、枠数を上書きする。保存すると監査ログに残り、ボードにすぐ反映される" />
        </h2>
        {settings?.updatedBy ? (
          <span className="lead">
            最終更新 {settings.updatedBy}・{isoToJstDisplay(settings.updatedAt)}
          </span>
        ) : null}
      </div>
      <div className="form-grid">
        <label className="field col">
          <span>担当 CS のメール（上書き）</span>
          <input className="ctl" type="email" value={form.csOwnerEmail} disabled={!canEdit} placeholder={`空なら ${defaults.ownerName ?? '未設定'}（${defaults.ownerSrc}）`} onChange={(e) => setForm({ ...form, csOwnerEmail: e.target.value })} aria-label="担当 CS のメール" />
        </label>
        <label className="field col">
          <span>担当 CS の表示名</span>
          <input className="ctl" value={form.csOwnerName} disabled={!canEdit} onChange={(e) => setForm({ ...form, csOwnerName: e.target.value })} aria-label="担当 CS の表示名" />
        </label>
        <label className="field col">
          <span>スカウト枠の期間</span>
          <select className="ctl" value={form.scoutLimitPeriod} disabled={!canEdit} onChange={(e) => setForm({ ...form, scoutLimitPeriod: e.target.value as 'month' | 'contract' })} aria-label="スカウト枠の期間">
            <option value="month">月間枠（毎月リセット）</option>
            <option value="contract">契約期間の累計</option>
          </select>
        </label>
        <label className="field col">
          <span>スカウト枠（上書き）</span>
          <input className="ctl num" inputMode="numeric" value={form.scoutLimitOverride} disabled={!canEdit} placeholder={defaults.scoutLimit === null ? '枠なし' : fmtInt(defaults.scoutLimit)} onChange={(e) => setForm({ ...form, scoutLimitOverride: e.target.value })} aria-label="スカウト枠の上書き" />
        </label>
        <label className="field col">
          <span>求人枠（上書き）</span>
          <input className="ctl num" inputMode="numeric" value={form.jobLimitOverride} disabled={!canEdit} placeholder={defaults.jobLimit === null ? '枠なし' : fmtInt(defaults.jobLimit)} onChange={(e) => setForm({ ...form, jobLimitOverride: e.target.value })} aria-label="求人枠の上書き" />
        </label>
        <label className="field col wide">
          <span>メモ</span>
          <textarea className="ctl" rows={2} maxLength={500} value={form.memo} disabled={!canEdit} onChange={(e) => setForm({ ...form, memo: e.target.value })} aria-label="メモ" />
        </label>
      </div>
      <div className="form-actions">
        <Button variant="primary" onClick={save} loading={saving} disabled={!canEdit}>
          設定を保存
        </Button>
        {msg ? (
          <span className={`small ${msg.tone === 'err' ? 'err' : 'muted'}`} role="status">
            {msg.text}
          </span>
        ) : null}
        {!canEdit ? <span className="small muted">閲覧のみ（Google ログインで編集できます）</span> : null}
      </div>
    </section>
  );
}
