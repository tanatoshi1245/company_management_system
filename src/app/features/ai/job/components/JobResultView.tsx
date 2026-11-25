import { useState } from 'react';
import { JOB_TEXT_MAX, JOB_TITLE_MAX, type JobResult } from '../../../../../shared/ai/job';
import { AI_TEXT } from '../../../../../shared/ai/options';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { DraftEditor } from '../../common/DraftEditor';
import { BenchmarkBasisView, ResultSection, ReviewList, TraitList } from '../../common/ResultParts';
import { jobDraftText, withJobDraft } from '../jobModel';

/**
 * ③ の結果: 要約 → 参考にした母集団 → 上位に共通する特徴 → 添削の指摘 → 求人票の案（タイトル・仕事内容・応募条件。コピー・手直しと保存）。
 * result は直した版があればそれ。onSave には、結果と同じ形（案だけ差し替えたもの）を渡す。
 */
export function JobResultView({ result, edited, canEdit, onSave, onClearEdited }: { result: JobResult; edited: boolean; canEdit: boolean; onSave: (result: JobResult) => Promise<void>; onClearEdited?: () => Promise<void> }) {
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const draft = result.draft;
  return (
    <div className="ai-result-body">
      <ResultSection title="要約">
        <p className="ai-summary">{result.summary}</p>
      </ResultSection>
      <BenchmarkBasisView basis={result.basis} rateLabel="応募率（閲覧 → 応募）" sampleLabel="読んだ求人" />
      <TraitList title="応募率の高い求人に共通する構成・特徴" traits={result.traits} />
      <ReviewList items={result.review} />
      <ResultSection
        title="求人票の案"
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
        <DraftEditor
          parts={[
            { key: 'title', label: '求人タイトル', value: draft.title, max: JOB_TITLE_MAX },
            { key: 'description', label: '仕事内容', value: draft.description, multiline: true, max: JOB_TEXT_MAX },
            { key: 'requirements', label: '応募条件', value: draft.requirements, multiline: true, max: JOB_TEXT_MAX },
          ]}
          copyAllText={jobDraftText(draft)}
          canEdit={canEdit}
          onSave={async (values) => {
            const next = withJobDraft(result, { title: values.title ?? '', description: values.description ?? '', requirements: values.requirements ?? '' });
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
        <p className="muted small">{'{{企業名}} などの差し込みは、掲載する前に置き換えてください'}</p>
      </ResultSection>
    </div>
  );
}
