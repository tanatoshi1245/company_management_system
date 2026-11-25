import { useEffect, useState } from 'react';
import { SCOUT_BODY_MAX, SCOUT_SUBJECT_MAX, type ScoutResult } from '../../../../../shared/ai/scout';
import { AI_TEXT } from '../../../../../shared/ai/options';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Segmented } from '../../../../components/ui/Segmented';
import { DraftEditor } from '../../common/DraftEditor';
import { BenchmarkBasisView, ResultSection, ReviewList, TraitList } from '../../common/ResultParts';
import { scoutDraftText, withScoutDraft } from '../scoutModel';

/**
 * ② の結果: 要約 → 参考にした母集団 → 上位に共通する特徴 → 添削の指摘 → 文面の案（タブで 1〜3 個。コピー・手直しと保存）。
 * result は直した版があればそれ。onSave には、結果と同じ形（案だけ差し替えたもの）を渡す。
 */
export function ScoutResultView({ result, edited, canEdit, onSave, onClearEdited }: { result: ScoutResult; edited: boolean; canEdit: boolean; onSave: (result: ScoutResult) => Promise<void>; onClearEdited?: () => Promise<void> }) {
  const [tab, setTab] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  useEffect(() => {
    if (tab >= result.drafts.length) setTab(0);
  }, [tab, result.drafts.length]);
  const index = Math.min(tab, result.drafts.length - 1);
  const draft = result.drafts[index];
  return (
    <div className="ai-result-body">
      <ResultSection title="要約">
        <p className="ai-summary">{result.summary}</p>
      </ResultSection>
      <BenchmarkBasisView basis={result.basis} rateLabel="返信率" sampleLabel="読んだ文面" />
      <TraitList title="返信率の高い文面に共通する構成・特徴" traits={result.traits} />
      <ReviewList items={result.review} />
      <ResultSection
        title="文面の案"
        actions={
          edited ? (
            <span className="ai-edited">
              <Badge tone="navy">{AI_TEXT.edited}</Badge>
              {onClearEdited ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  loading={clearing}
                  onClick={async () => {
                    setClearing(true);
                    setClearError(null);
                    try {
                      await onClearEdited();
                    } catch (e) {
                      setClearError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setClearing(false);
                    }
                  }}
                >
                  元の案に戻す
                </Button>
              ) : null}
            </span>
          ) : null
        }
      >
        {clearError ? (
          <div className="notice error" role="alert">
            <span>{clearError}</span>
          </div>
        ) : null}
        {result.drafts.length > 1 ? <Segmented options={result.drafts.map((d, i) => ({ key: String(i), label: d.label }))} value={String(index)} onChange={(k) => setTab(Number(k))} ariaLabel="文面の案" /> : <Badge tone="neutral">{draft.label}</Badge>}
        <DraftEditor
          key={index}
          parts={[
            { key: 'subject', label: '件名', value: draft.subject, max: SCOUT_SUBJECT_MAX },
            { key: 'body', label: '本文', value: draft.body, multiline: true, max: SCOUT_BODY_MAX },
          ]}
          copyAllText={scoutDraftText(draft)}
          canEdit={canEdit}
          onSave={async (values) => {
            const next = withScoutDraft(result, index, { subject: values.subject ?? '', body: values.body ?? '' });
            if (!next.ok) return next.errors;
            await onSave(next.result);
            return null;
          }}
          footer={
            <p className="ai-rationale">
              <span className="tag">この案にした理由</span>
              {draft.rationale}
            </p>
          }
        />
        <p className="muted small">{'{{企業名}} {{候補者名}} などの差し込みは、送る前に置き換えてください'}</p>
      </ResultSection>
    </div>
  );
}
