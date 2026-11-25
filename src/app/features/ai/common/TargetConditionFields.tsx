import { useId } from 'react';
import type { AiCompanyDefaultsResponse } from '../../../../shared/ai/common';
import { AI_OCCUPATIONS_MAX } from '../../../../shared/ai/scout';
import { AI_AGE_RANGE_OPTIONS, AI_CONDITION_LABEL, AI_LANGUAGE_OPTIONS, AI_LOCATION_OPTIONS, AI_NATIONALITY_OPTIONS, type TargetCondition, type TargetConditionKey } from '../../../../shared/ai/options';
import { Combobox } from './Combobox';
import { TagCombobox } from './TagCombobox';
import { AiField, CharCount } from './Field';

const NONE: string[] = [];

/**
 * ②③ 共通の条件の入力（どんな人に向けた文面・求人か）。
 * 業界・掲載職種は企業を選ぶと自動で入り（useCompanyAutofill）、ここで直せる。どの欄も、候補から選ぶか、そのまま文字を入れる。
 */
export function TargetConditionFields({
  value,
  onChange,
  defaults,
  disabled,
  errors,
}: {
  value: TargetCondition;
  onChange: (patch: Partial<TargetCondition>) => void;
  defaults: AiCompanyDefaultsResponse | null;
  disabled?: boolean;
  /** 項目ごとの誤り（欄の下に出す） */
  errors?: Partial<Record<TargetConditionKey, string>>;
}) {
  const uid = useId();
  const id = (k: TargetConditionKey) => `${uid}-${k}`;
  const L = AI_CONDITION_LABEL;
  return (
    <div className="ai-fields">
      <AiField label={L.industry} htmlFor={id('industry')} required error={errors?.industry} hint="企業を選ぶと自動で入ります（直せます）">
        <Combobox id={id('industry')} value={value.industry} onChange={(industry) => onChange({ industry })} options={defaults?.industryOptions ?? NONE} placeholder="例: IT・通信" disabled={disabled} invalid={Boolean(errors?.industry)} />
      </AiField>
      <AiField label={L.positionName} htmlFor={id('positionName')} required error={errors?.positionName}>
        <input id={id('positionName')} className="ctl" type="text" maxLength={80} value={value.positionName} disabled={disabled} placeholder="例: 法人営業マネージャー" aria-invalid={errors?.positionName ? true : undefined} onChange={(e) => onChange({ positionName: e.target.value })} />
      </AiField>
      <AiField label={L.occupations} htmlFor={id('occupations')} required wide error={errors?.occupations} hint={`企業を選ぶと自動で入ります（直せます。${AI_OCCUPATIONS_MAX} 個まで）`}>
        <TagCombobox id={id('occupations')} values={value.occupations} onChange={(occupations) => onChange({ occupations })} options={defaults?.occupationOptions ?? NONE} max={AI_OCCUPATIONS_MAX} placeholder="職種を入力して選ぶ" disabled={disabled} ariaLabel={L.occupations} invalid={Boolean(errors?.occupations)} />
      </AiField>
      <AiField label={L.ageRange} htmlFor={id('ageRange')} error={errors?.ageRange}>
        <Combobox id={id('ageRange')} value={value.ageRange} onChange={(ageRange) => onChange({ ageRange })} options={AI_AGE_RANGE_OPTIONS} placeholder="例: 20 代後半〜30 代前半" disabled={disabled} />
      </AiField>
      <AiField label={L.nationality} htmlFor={id('nationality')} error={errors?.nationality}>
        <Combobox id={id('nationality')} value={value.nationality} onChange={(nationality) => onChange({ nationality })} options={AI_NATIONALITY_OPTIONS} placeholder="例: 問わない" disabled={disabled} />
      </AiField>
      <AiField label={L.language} htmlFor={id('language')} error={errors?.language}>
        <Combobox id={id('language')} value={value.language} onChange={(language) => onChange({ language })} options={AI_LANGUAGE_OPTIONS} placeholder="例: 英語ビジネスレベル以上" disabled={disabled} />
      </AiField>
      <AiField label={L.location} htmlFor={id('location')} error={errors?.location}>
        <Combobox id={id('location')} value={value.location} onChange={(location) => onChange({ location })} options={AI_LOCATION_OPTIONS} placeholder="例: 東京都" disabled={disabled} />
      </AiField>
      <AiField label={L.note} htmlFor={id('note')} error={errors?.note} wide hint={<CharCount value={value.note} max={500} />}>
        <textarea id={id('note')} className="ctl" rows={3} value={value.note} disabled={disabled} placeholder="任意。重視したい点・避けたい表現など（企業名・個人名は書かない）" onChange={(e) => onChange({ note: e.target.value })} />
      </AiField>
    </div>
  );
}
