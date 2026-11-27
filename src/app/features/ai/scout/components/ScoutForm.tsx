import { useId } from 'react';
import type { AiCompanyDefaultsResponse, AiCompanyOption } from '../../../../../shared/ai/common';
import type { PiiFinding } from '../../../../../shared/ai/pii';
import { AI_LOCATION_OPTIONS, AI_TEXT, SCOUT_TEXT } from '../../../../../shared/ai/options';
import { AI_OCCUPATIONS_MAX, SCOUT_BODY_MAX, SCOUT_LANG_LABEL, SCOUT_LANGS, SCOUT_PURPOSES, SCOUT_SUBJECT_MAX, type ScoutOptionsResponse, type ScoutPurpose } from '../../../../../shared/ai/scout';
import { Button } from '../../../../components/ui/Button';
import { Segmented } from '../../../../components/ui/Segmented';
import { Combobox } from '../../common/Combobox';
import { CompanyCombobox } from '../../common/CompanyCombobox';
import { AiField, CharCount } from '../../common/Field';
import { PiiNotice } from '../../common/PiiNotice';
import { TagCombobox } from '../../common/TagCombobox';
import { countFilters, EMPTY_SCOUT_FILTERS, type ScoutForm as ScoutFormState } from '../scoutModel';
import { ScoutFilterFields } from './ScoutFilterFields';

/** 目的の切り替えの文（画面では短く） */
export const SCOUT_PURPOSE_SHORT: Record<ScoutPurpose, string> = { template: '文面の作成', review: '文面の添削' };
const PURPOSE_OPTIONS = SCOUT_PURPOSES.map((key) => ({ key, label: SCOUT_PURPOSE_SHORT[key] }));
const LANG_OPTIONS = SCOUT_LANGS.map((key) => ({ key, label: SCOUT_LANG_LABEL[key] }));
export const SCOUT_RUN_LABEL: Record<ScoutPurpose, string> = { template: '文面を作る', review: '添削する' };
const NONE: string[] = [];

/** ② の入力（目的 → 既存企業 → 添削する文面 → 求人の内容 → 送る相手の条件 → 実行） */
export function ScoutForm({
  purpose,
  onPurpose,
  companies,
  companyId,
  onCompany,
  form,
  onForm,
  defaults,
  options,
  optionsLoading,
  optionsError,
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
  onForm: (patch: Partial<ScoutFormState>) => void;
  defaults: AiCompanyDefaultsResponse | null;
  options: ScoutOptionsResponse | null;
  optionsLoading: boolean;
  optionsError: string | null;
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
  const nFilters = countFilters(form.filters);
  return (
    <form
      className="ai-form"
      aria-label="スカウト文面の AI 作成の入力"
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
              <textarea id={`${uid}-body`} className="ctl" rows={8} value={form.body} disabled={disabled} placeholder="スカウトメールの本文を貼り付けます" aria-invalid={errors.body ? true : undefined} onChange={(e) => onForm({ body: e.target.value })} />
            </AiField>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="ai-group">
        <legend>求人の内容</legend>
        <div className="ai-fields">
          <AiField label="業界" htmlFor={`${uid}-industry`} required error={errors.industry} hint="企業を選ぶと自動で入ります（直せます）">
            <Combobox id={`${uid}-industry`} value={form.industry} onChange={(industry) => onForm({ industry })} options={defaults?.industryOptions ?? NONE} placeholder="例: IT・通信" disabled={disabled} invalid={Boolean(errors.industry)} />
          </AiField>
          <AiField label="ポジション名" htmlFor={`${uid}-position`} required error={errors.positionName}>
            <input id={`${uid}-position`} className="ctl" type="text" maxLength={80} value={form.positionName} disabled={disabled} placeholder="例: 法人営業マネージャー" aria-invalid={errors.positionName ? true : undefined} onChange={(e) => onForm({ positionName: e.target.value })} />
          </AiField>
          <AiField label="掲載職種" htmlFor={`${uid}-occ`} wide error={errors.jobOccupations} hint={`企業を選ぶと自動で入ります（直せます。${AI_OCCUPATIONS_MAX} 個まで）`}>
            <TagCombobox id={`${uid}-occ`} values={form.jobOccupations} onChange={(jobOccupations) => onForm({ jobOccupations })} options={defaults?.occupationOptions ?? NONE} max={AI_OCCUPATIONS_MAX} placeholder="職種を入力して選ぶ" disabled={disabled} ariaLabel="掲載職種" invalid={Boolean(errors.jobOccupations)} />
          </AiField>
          <AiField label="勤務地" htmlFor={`${uid}-loc`} error={errors.jobLocation}>
            <Combobox id={`${uid}-loc`} value={form.jobLocation} onChange={(jobLocation) => onForm({ jobLocation })} options={AI_LOCATION_OPTIONS} placeholder="例: 東京都" disabled={disabled} />
          </AiField>
          <AiField label="文面の言語">
            <Segmented options={LANG_OPTIONS} value={form.lang} onChange={(lang) => onForm({ lang })} ariaLabel="文面の言語" />
          </AiField>
          <AiField label="補足" htmlFor={`${uid}-note`} error={errors.note} wide hint={<CharCount value={form.note} max={500} />}>
            <textarea id={`${uid}-note`} className="ctl" rows={2} value={form.note} disabled={disabled} placeholder="任意。訴求したい点・避けたい表現など（企業名・個人名は書かない）" onChange={(e) => onForm({ note: e.target.value })} />
          </AiField>
        </div>
      </fieldset>

      <fieldset className="ai-group">
        <legend>{SCOUT_TEXT.filtersLegend}</legend>
        <div className="ai-filter-head">
          <span className="muted small">{nFilters ? `${nFilters} 個の条件を指定中` : '指定なし = 条件を付けずに分析します'}</span>
          {nFilters ? (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onForm({ filters: { ...EMPTY_SCOUT_FILTERS } })}>
              条件をすべて外す
            </Button>
          ) : null}
        </div>
        <ScoutFilterFields value={form.filters} onChange={(filters) => onForm({ filters })} options={options} loading={optionsLoading} error={optionsError} disabled={disabled} />
      </fieldset>

      <PiiNotice findings={pii} />

      <div className="ai-run">
        <Button type="submit" variant="primary" disabled={!canRun} loading={busy}>
          {busy ? '作っています…' : SCOUT_RUN_LABEL[purpose]}
        </Button>
        {blockedReason ? <span className="muted small">{blockedReason}</span> : null}
      </div>
    </form>
  );
}
