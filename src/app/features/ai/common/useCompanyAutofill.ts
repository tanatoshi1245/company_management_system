import { useCallback, useEffect, useRef } from 'react';
import type { AiCompanyDefaultsResponse } from '../../../../shared/ai/common';
import { AI_AUTOFILL_OCCUPATIONS } from '../../../../shared/ai/options';
import type { ApiError } from '../../../lib/api';
import { useAiCompanyDefaults } from './aiApi';

export type AutofillField = 'industry' | 'occupations';
export interface AutofillPatch {
  industry?: string;
  occupations?: string[];
}

export interface CompanyAutofill {
  /** 企業の既定値（業界・職種の選択肢、直近の掲載求人）。読み込み前・企業なしは null */
  defaults: AiCompanyDefaultsResponse | null;
  loading: boolean;
  error: ApiError | Error | null;
  /** 入力者がその項目を直した（この企業を選んでいる間は、自動で上書きしない） */
  markEdited: (field: AutofillField) => void;
  /** いまの入力を保つ（履歴から開いた結果の入力を欄に入れたとき。その企業の自動入力をしない） */
  keep: (companyId: string) => void;
}

/**
 * 企業を選んだら defaults を取り、業界と掲載職種（多い順の上位 AI_AUTOFILL_OCCUPATIONS 個）を入れる。
 * 入れるのは企業を選んだときの 1 回だけ。defaults が届く前に入力者が直した項目は上書きしない。
 * 企業を選び直したとき（外して選ぶ・別の企業にする）は入れ直す。
 */
export function useCompanyAutofill(companyId: string | null, apply: (patch: AutofillPatch) => void): CompanyAutofill {
  const res = useAiCompanyDefaults(companyId);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  /** 自動入力を済ませた企業 */
  const appliedFor = useRef<string | null>(null);
  const edited = useRef<{ companyId: string | null; fields: Set<AutofillField> }>({ companyId: null, fields: new Set() });
  /** 自動で入れたままの項目（入力者が直したら外す） */
  const filled = useRef<Set<AutofillField>>(new Set());
  const data = res.data && res.data.companyId === companyId ? res.data : null;

  useEffect(() => {
    if (!companyId) {
      appliedFor.current = null;
      edited.current = { companyId: null, fields: new Set() };
      return;
    }
    if (edited.current.companyId !== companyId) edited.current = { companyId, fields: new Set() };
    if (!data || appliedFor.current === companyId) return;
    appliedFor.current = companyId;
    const skip = edited.current.fields;
    const patch: AutofillPatch = {};
    // 値が無い企業へ選び直したときは、前の企業から自動で入れた値だけを消す（入力者が入れた値は残す）
    if (!skip.has('industry')) {
      if (data.industry) {
        patch.industry = data.industry;
        filled.current.add('industry');
      } else if (filled.current.delete('industry')) patch.industry = '';
    }
    if (!skip.has('occupations')) {
      if (data.occupations.length) {
        patch.occupations = data.occupations.slice(0, AI_AUTOFILL_OCCUPATIONS);
        filled.current.add('occupations');
      } else if (filled.current.delete('occupations')) patch.occupations = [];
    }
    if (Object.keys(patch).length) applyRef.current(patch);
  }, [companyId, data]);

  const markEdited = useCallback(
    (field: AutofillField) => {
      if (edited.current.companyId !== companyId) edited.current = { companyId, fields: new Set() };
      edited.current.fields.add(field);
      filled.current.delete(field);
    },
    [companyId],
  );
  const keep = useCallback((id: string) => {
    appliedFor.current = id;
    filled.current.clear();
  }, []);

  return { defaults: data, loading: res.loading, error: res.error, markEdited, keep };
}
