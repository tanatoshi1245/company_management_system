import { useId } from 'react';
import type { AiCompanyDefaultsResponse, AiCompanyJob, AiCompanyOption } from '../../../../../shared/ai/common';
import type { PiiFinding } from '../../../../../shared/ai/pii';
import { AI_SALARY_OPTIONS, AI_TEXT, type TargetCondition } from '../../../../../shared/ai/options';
import { JOB_PURPOSE_LABEL, JOB_PURPOSES, JOB_TEXT_MAX, JOB_TITLE_MAX, type JobPurpose, type JobSource } from '../../../../../shared/ai/job';
import { Button } from '../../../../components/ui/Button';
import { Segmented } from '../../../../components/ui/Segmented';
import { Combobox } from '../../common/Combobox';
import { CompanyCombobox } from '../../common/CompanyCombobox';
import { AiField, CharCount } from '../../common/Field';
import { PiiNotice } from '../../common/PiiNotice';
import { TargetConditionFields } from '../../common/TargetConditionFields';
import type { JobForm as JobFormState } from '../jobModel';
import { PostedJobPicker } from './PostedJobPicker';

const PURPOSE_OPTIONS = JOB_PURPOSES.map((key) => ({ key, label: JOB_PURPOSE_LABEL[key] }));
const SOURCE_OPTIONS: { key: JobSource; label: string }[] = [
  { key: 'posted', label: '掲載中の求人から選ぶ' },
  { key: 'pasted', label: '文を貼る' },
];
export const JOB_RUN_LABEL: Record<JobPurpose, string> = { review: '添削する', create: '作成する' };

/** ③ の入力（目的 → 既存企業 → 添削する求人（選ぶ / 貼る）→ 条件 → 実行） */
export function JobForm({
  purpose,
  onPurpose,
  companies,
  companyId,
  onCompany,
  form,
  onForm,
  onPostedJob,
  onCond,
  defaults,
  defaultsLoading,
  errors,
  pii,
  disabled,
  busy,
  canRun,
  blockedReason,
  onRun,
}: {
  purpose: JobPurpose;
  onPurpose: (p: JobPurpose) => void;
  companies: AiCompanyOption[];
  companyId: string | null;
  onCompany: (id: string | null) => void;
  form: JobFormState;
  onForm: (patch: Partial<Omit<JobFormState, 'cond'>>) => void;
  /** 掲載中の求人を選んだ / 外した（選ぶと、ポジション名・職種・勤務地・言語力・年収が自動で入る） */
  onPostedJob: (job: AiCompanyJob | null) => void;
  onCond: (patch: Partial<TargetCondition>) => void;
  defaults: AiCompanyDefaultsResponse | null;
  defaultsLoading: boolean;
  errors: Record<string, string>;
  pii: PiiFinding[];
  disabled: boolean;
  busy: boolean;
  canRun: boolean;
  blockedReason: string | null;
  onRun: () => void;
}) {
  const uid = useId();
  return (
    <form
      className="ai-form"
      aria-label="求人の AI 添削の入力"
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
          <legend>添削したい求人</legend>
          <div className="ai-fields">
            <AiField label="求人の渡し方" wide>
              <Segmented options={SOURCE_OPTIONS} value={form.source} onChange={(source) => onForm({ source })} ariaLabel="求人の渡し方" />
            </AiField>
            {form.source === 'posted' ? (
              <AiField
                label="掲載中の求人"
                htmlFor={`${uid}-posted`}
                required
                wide
                error={errors.jobKey}
                hint={companyId && defaultsLoading ? '掲載求人を読み込んでいます…' : '選ぶと、ポジション名・職種・勤務地・言語力・年収が自動で入ります（直せます）。求人の本文は、セッションが読みます'}
              >
                <PostedJobPicker id={`${uid}-posted`} jobs={defaults?.jobs ?? []} value={form.jobKey} onChange={onPostedJob} disabled={disabled || (Boolean(companyId) && !defaults)} noCompany={!companyId} invalid={Boolean(errors.jobKey)} />
              </AiField>
            ) : (
              <>
                <p className="ai-rule wide">{AI_TEXT.piiRule}</p>
                <AiField label="求人タイトル" htmlFor={`${uid}-title`} wide error={errors.title} hint={<CharCount value={form.title} max={JOB_TITLE_MAX} />}>
                  <input id={`${uid}-title`} className="ctl" type="text" value={form.title} disabled={disabled} placeholder="例: 【英語を活かす】法人営業マネージャー" onChange={(e) => onForm({ title: e.target.value })} />
                </AiField>
                <AiField label="仕事内容" htmlFor={`${uid}-description`} required wide error={errors.description} hint={<CharCount value={form.description} max={JOB_TEXT_MAX} />}>
                  <textarea id={`${uid}-description`} className="ctl" rows={8} value={form.description} disabled={disabled} placeholder="求人の仕事内容を貼り付けます" aria-invalid={errors.description ? true : undefined} onChange={(e) => onForm({ description: e.target.value })} />
                </AiField>
                <AiField label="応募条件" htmlFor={`${uid}-requirements`} wide error={errors.requirements} hint={<CharCount value={form.requirements} max={JOB_TEXT_MAX} />}>
                  <textarea id={`${uid}-requirements`} className="ctl" rows={6} value={form.requirements} disabled={disabled} placeholder="必須の経験・スキル、歓迎する経験など" onChange={(e) => onForm({ requirements: e.target.value })} />
                </AiField>
              </>
            )}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="ai-group">
        <legend>どんな人に向けた求人か</legend>
        <TargetConditionFields value={form.cond} onChange={onCond} defaults={defaults} disabled={disabled} errors={errors} />
        <div className="ai-fields">
          <AiField label="年収" htmlFor={`${uid}-salary`} error={errors.salary}>
            <Combobox id={`${uid}-salary`} value={form.salary} onChange={(salary) => onForm({ salary })} options={AI_SALARY_OPTIONS} placeholder="例: 500〜800 万円" disabled={disabled} />
          </AiField>
        </div>
      </fieldset>

      <PiiNotice findings={pii} />

      <div className="ai-run">
        <Button type="submit" variant="primary" disabled={!canRun} loading={busy}>
          {busy ? '立ち上げています…' : JOB_RUN_LABEL[purpose]}
        </Button>
        {blockedReason ? <span className="muted small">{blockedReason}</span> : null}
      </div>
    </form>
  );
}
