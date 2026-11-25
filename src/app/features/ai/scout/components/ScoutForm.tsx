import { useId } from 'react';
import type { AiCompanyDefaultsResponse, AiCompanyOption } from '../../../../../shared/ai/common';
import type { PiiFinding } from '../../../../../shared/ai/pii';
import { AI_TEXT, type TargetCondition } from '../../../../../shared/ai/options';
import { SCOUT_BODY_MAX, SCOUT_PURPOSE_LABEL, SCOUT_PURPOSES, SCOUT_SUBJECT_MAX, type ScoutPurpose } from '../../../../../shared/ai/scout';
import { Button } from '../../../../components/ui/Button';
import { Segmented } from '../../../../components/ui/Segmented';
import { CompanyCombobox } from '../../common/CompanyCombobox';
import { AiField, CharCount } from '../../common/Field';
import { PiiNotice } from '../../common/PiiNotice';
import { TargetConditionFields } from '../../common/TargetConditionFields';
import type { ScoutForm as ScoutFormState } from '../scoutModel';

const PURPOSE_OPTIONS = SCOUT_PURPOSES.map((key) => ({ key, label: SCOUT_PURPOSE_LABEL[key] }));
export const SCOUT_RUN_LABEL: Record<ScoutPurpose, string> = { review: '添削する', template: '作成する' };

/** ② の入力（目的 → 既存企業 → 添削する文面 → 条件 → 実行） */
export function ScoutForm({
  purpose,
  onPurpose,
  companies,
  companyId,
  onCompany,
  form,
  onForm,
  onCond,
  defaults,
  errors,
  pii,
  disabled,
  busy,
  canRun,
  blockedReason,
  onRun,
}: {
  purpose: ScoutPurpose;
  onPurpose: (p: ScoutPurpose) => void;
  companies: AiCompanyOption[];
  companyId: string | null;
  onCompany: (id: string | null) => void;
  form: ScoutFormState;
  onForm: (patch: Partial<Pick<ScoutFormState, 'subject' | 'body'>>) => void;
  onCond: (patch: Partial<TargetCondition>) => void;
  defaults: AiCompanyDefaultsResponse | null;
  errors: Record<string, string>;
  pii: PiiFinding[];
  disabled: boolean;
  busy: boolean;
  canRun: boolean;
  /** 実行できない理由（ボタンの横に出す） */
  blockedReason: string | null;
  onRun: () => void;
}) {
  const uid = useId();
  return (
    <form
      className="ai-form"
      aria-label="スカウト文面の AI 添削の入力"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (canRun) onRun();
      }}
    >
      <div className="ai-fields">
        <AiField label="目的" wide>
          <Segmented options={PURPOSE_OPTIONS} value={purpose} onChange={onPurpose} ariaLabel="目的" />
        </AiField>
        <AiField label="既存企業を選択" htmlFor={`${uid}-company`} required wide error={errors.company} hint={AI_TEXT.companyOnlyBoard}>
          <CompanyCombobox id={`${uid}-company`} companies={companies} value={companyId} onChange={onCompany} disabled={disabled} />
        </AiField>
      </div>

      {purpose === 'review' ? (
        <fieldset className="ai-group">
          <legend>添削したいメール</legend>
          <p className="ai-rule">{AI_TEXT.piiRule}</p>
          <div className="ai-fields">
            <AiField label="件名" htmlFor={`${uid}-subject`} required wide error={errors.subject} hint={<CharCount value={form.subject} max={SCOUT_SUBJECT_MAX} />}>
              <input id={`${uid}-subject`} className="ctl" type="text" value={form.subject} disabled={disabled} placeholder="例: 【{{企業名}}】法人営業マネージャーのご案内" aria-invalid={errors.subject ? true : undefined} onChange={(e) => onForm({ subject: e.target.value })} />
            </AiField>
            <AiField label="本文" htmlFor={`${uid}-body`} required wide error={errors.body} hint={<CharCount value={form.body} max={SCOUT_BODY_MAX} />}>
              <textarea id={`${uid}-body`} className="ctl" rows={10} value={form.body} disabled={disabled} placeholder="スカウトメールの本文を貼り付けます" aria-invalid={errors.body ? true : undefined} onChange={(e) => onForm({ body: e.target.value })} />
            </AiField>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="ai-group">
        <legend>どんな人に向けた文面か</legend>
        <TargetConditionFields value={form.cond} onChange={onCond} defaults={defaults} disabled={disabled} errors={errors} />
      </fieldset>

      <PiiNotice findings={pii} />

      <div className="ai-run">
        <Button type="submit" variant="primary" disabled={!canRun} loading={busy}>
          {busy ? '立ち上げています…' : SCOUT_RUN_LABEL[purpose]}
        </Button>
        {blockedReason ? <span className="muted small">{blockedReason}</span> : null}
      </div>
    </form>
  );
}
