import { useId, type ReactNode } from 'react';
import type { AiCompanyDefaultsResponse, AiCompanyOption } from '../../../../../shared/ai/common';
import type { PiiFinding } from '../../../../../shared/ai/pii';
import { AI_LOCATION_OPTIONS, AI_TEXT, SCOUT_TEXT } from '../../../../../shared/ai/options';
import {
  AI_OCCUPATIONS_MAX,
  SCOUT_BASES,
  SCOUT_BASIS_DESCRIPTION,
  SCOUT_BASIS_LABEL,
  SCOUT_BODY_MAX,
  SCOUT_LANG_LABEL,
  SCOUT_LANGS,
  SCOUT_PURPOSES,
  SCOUT_SUBJECT_MAX,
  scoutBasisUsesJob,
  scoutBasisUsesMember,
  type ScoutBasisKind,
  type ScoutJobSummary,
  type ScoutMemberSummary,
  type ScoutOptionsResponse,
  type ScoutPurpose,
} from '../../../../../shared/ai/scout';
import { Button } from '../../../../components/ui/Button';
import { Segmented } from '../../../../components/ui/Segmented';
import { Combobox } from '../../common/Combobox';
import { CompanyCombobox } from '../../common/CompanyCombobox';
import { AiField, CharCount } from '../../common/Field';
import { PiiNotice } from '../../common/PiiNotice';
import { TagCombobox } from '../../common/TagCombobox';
import { countFilters, EMPTY_SCOUT_FILTERS, type ScoutForm as ScoutFormState } from '../scoutModel';
import { ScoutFilterFields } from './ScoutFilterFields';
import { ScoutJobCard, ScoutMemberCard } from './ScoutTargetCards';

/** 目的の切り替えの文（画面では短く） */
export const SCOUT_PURPOSE_SHORT: Record<ScoutPurpose, string> = { template: '文面の作成', review: '文面の添削' };
const PURPOSE_OPTIONS = SCOUT_PURPOSES.map((key) => ({ key, label: SCOUT_PURPOSE_SHORT[key] }));
const LANG_OPTIONS = SCOUT_LANGS.map((key) => ({ key, label: SCOUT_LANG_LABEL[key] }));
export const SCOUT_RUN_LABEL: Record<ScoutPurpose, string> = { template: 'この内容で文面を作る', review: 'この内容で添削する' };
const NONE: string[] = [];

/** 求人 ID・会員 ID の欄の状態（確かめた内容は、いまの ID・企業のものだけ） */
export interface ScoutIdField<T> {
  text: string;
  onText: (text: string) => void;
  /** 確かめる（GET だけ。AI は動かない） */
  onCheck: () => void;
  loading: boolean;
  error: string | null;
  summary: T | null;
}

/** ID の欄 +「確かめる」ボタン + 確かめた内容。Enter は「確かめる」（フォームの送信 = AI の実行にしない） */
function IdLookup<T>({ id, label, hint, buttonLabel, field, disabled, disabledReason, children }: { id: string; label: string; hint: string; buttonLabel: string; field: ScoutIdField<T>; disabled: boolean; disabledReason?: string | null; children: ReactNode }) {
  const blocked = disabled || Boolean(disabledReason);
  return (
    <div className="ai-lookup">
      <AiField label={label} htmlFor={id} required error={field.error} hint={disabledReason ?? hint}>
        <div className="ai-lookup-row">
          <input
            id={id}
            className="ctl num"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={12}
            value={field.text}
            disabled={disabled}
            placeholder="例: 123456"
            aria-invalid={field.error ? true : undefined}
            onChange={(e) => field.onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (!blocked && !field.loading) field.onCheck();
            }}
          />
          <Button disabled={blocked || !field.text.trim()} loading={field.loading} onClick={field.onCheck}>
            {field.loading ? SCOUT_TEXT.checking : buttonLabel}
          </Button>
        </div>
      </AiField>
      {field.summary ? children : null}
    </div>
  );
}

/**
 * ② の入力（既存企業 → 何をもとに作るか → 目的 → 添削する文面 → 求人 ID / 会員 ID を確かめる → 求人の内容 → 送る相手の条件 → 実行）。
 * **何をもとに作るかを選ぶまで、その先の入力欄と実行ボタンを出さない**（2026-11-27 ユーザー指示。選ぶ・確かめるだけでは AI は動かない）。
 */
export function ScoutForm({
  purpose,
  onPurpose,
  basis,
  bases = SCOUT_BASES,
  onBasis,
  job,
  member,
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
  /** 何をもとに作るか（null = まだ選んでいない） */
  basis: ScoutBasisKind | null;
  /** 出す作り方（既定は 4 つ。会員 ID から作る機能が閉じている間は、条件・求人 ID の 2 つだけ = scoutModel.ts の scoutBasesOf） */
  bases?: readonly ScoutBasisKind[];
  onBasis: (b: ScoutBasisKind) => void;
  job: ScoutIdField<ScoutJobSummary>;
  member: ScoutIdField<ScoutMemberSummary>;
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
  const usesJob = basis !== null && scoutBasisUsesJob(basis);
  const usesMember = basis !== null && scoutBasisUsesMember(basis);
  return (
    <form
      className="ai-form"
      aria-label="スカウト文面の AI 作成の入力"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (canRun && basis) onRun();
      }}
    >
      <div className="ai-fields">
        <AiField label="既存企業を選択" htmlFor={`${uid}-company`} required wide error={errors.company} hint={AI_TEXT.companyOnlyBoard}>
          <CompanyCombobox id={`${uid}-company`} companies={companies} value={companyId} onChange={onCompany} disabled={disabled} />
        </AiField>
      </div>

      <fieldset className="ai-group ai-basis-pick">
        <legend>{SCOUT_TEXT.basisLegend}</legend>
        <div className="ai-basis-cards" role="radiogroup" aria-label={SCOUT_TEXT.basisLegend}>
          {bases.map((b) => (
            <label key={b} className={`ai-basis-card${basis === b ? ' on' : ''}`}>
              <input type="radio" name={`${uid}-basis`} value={b} checked={basis === b} disabled={disabled} onChange={() => onBasis(b)} />
              <span className="txt">
                <b>{SCOUT_BASIS_LABEL[b]}</b>
                <span>{SCOUT_BASIS_DESCRIPTION[b]}</span>
              </span>
            </label>
          ))}
        </div>
        {basis === null ? <p className="muted small ai-basis-hint">{SCOUT_TEXT.basisHint}</p> : null}
      </fieldset>

      {basis === null ? null : (
        <>
          <div className="ai-fields">
            <AiField label="目的" wide>
              <Segmented options={PURPOSE_OPTIONS} value={purpose} onChange={onPurpose} ariaLabel="目的" />
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

          {usesJob ? (
            <fieldset className="ai-group">
              <legend>もとにする求人</legend>
              <IdLookup id={`${uid}-jobid`} label="求人 ID" hint={SCOUT_TEXT.jobIdHint} buttonLabel={SCOUT_TEXT.checkJob} field={job} disabled={disabled} disabledReason={companyId ? null : SCOUT_TEXT.jobNeedsCompany}>
                {job.summary ? <ScoutJobCard job={job.summary} /> : null}
              </IdLookup>
            </fieldset>
          ) : null}

          {usesMember ? (
            <fieldset className="ai-group">
              <legend>送る相手（候補者）</legend>
              <IdLookup id={`${uid}-memberid`} label="会員 ID" hint={SCOUT_TEXT.memberIdHint} buttonLabel={SCOUT_TEXT.checkMember} field={member} disabled={disabled}>
                {member.summary ? <ScoutMemberCard member={member.summary} /> : null}
              </IdLookup>
            </fieldset>
          ) : null}

          <fieldset className="ai-group">
            <legend>{usesJob ? '業界・言語・補足' : '求人の内容'}</legend>
            {usesJob ? <p className="muted small ai-group-note">{SCOUT_TEXT.jobFields}</p> : null}
            <div className="ai-fields">
              <AiField label="業界" htmlFor={`${uid}-industry`} required wide={usesJob} error={errors.industry} hint="企業を選ぶと自動で入ります（直せます）">
                <Combobox id={`${uid}-industry`} value={form.industry} onChange={(industry) => onForm({ industry })} options={defaults?.industryOptions ?? NONE} placeholder="例: IT・通信" disabled={disabled} invalid={Boolean(errors.industry)} />
              </AiField>
              {usesJob ? null : (
                <>
                  <AiField label="ポジション名" htmlFor={`${uid}-position`} required error={errors.positionName}>
                    <input id={`${uid}-position`} className="ctl" type="text" maxLength={80} value={form.positionName} disabled={disabled} placeholder="例: 法人営業マネージャー" aria-invalid={errors.positionName ? true : undefined} onChange={(e) => onForm({ positionName: e.target.value })} />
                  </AiField>
                  <AiField label="掲載職種" htmlFor={`${uid}-occ`} wide error={errors.jobOccupations} hint={`企業を選ぶと自動で入ります（直せます。${AI_OCCUPATIONS_MAX} 個まで）`}>
                    <TagCombobox id={`${uid}-occ`} values={form.jobOccupations} onChange={(jobOccupations) => onForm({ jobOccupations })} options={defaults?.occupationOptions ?? NONE} max={AI_OCCUPATIONS_MAX} placeholder="職種を入力して選ぶ" disabled={disabled} ariaLabel="掲載職種" invalid={Boolean(errors.jobOccupations)} />
                  </AiField>
                  <AiField label="勤務地" htmlFor={`${uid}-loc`} error={errors.jobLocation}>
                    <Combobox id={`${uid}-loc`} value={form.jobLocation} onChange={(jobLocation) => onForm({ jobLocation })} options={AI_LOCATION_OPTIONS} placeholder="例: 東京都" disabled={disabled} />
                  </AiField>
                </>
              )}
              <AiField label="文面の言語" wide={usesJob}>
                <Segmented options={LANG_OPTIONS} value={form.lang} onChange={(lang) => onForm({ lang })} ariaLabel="文面の言語" />
              </AiField>
              <AiField label="補足" htmlFor={`${uid}-note`} error={errors.note} wide hint={<CharCount value={form.note} max={500} />}>
                <textarea id={`${uid}-note`} className="ctl" rows={2} value={form.note} disabled={disabled} placeholder="任意。訴求したい点・避けたい表現など（企業名・個人名は書かない）" onChange={(e) => onForm({ note: e.target.value })} />
              </AiField>
            </div>
          </fieldset>

          {usesMember ? null : (
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
          )}

          <PiiNotice findings={pii} />

          <div className="ai-run">
            <Button type="submit" variant="primary" disabled={!canRun} loading={busy}>
              {busy ? '作っています…' : SCOUT_RUN_LABEL[purpose]}
            </Button>
            <span className="ai-run-note small">
              {blockedReason ? <span className="why">{blockedReason}</span> : null}
              <span className="muted">{SCOUT_TEXT.runHint}</span>
            </span>
          </div>
        </>
      )}
    </form>
  );
}
