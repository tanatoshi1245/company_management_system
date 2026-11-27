import { useState } from 'react';
import { SCOUT_BODY_MAX, SCOUT_SUBJECT_MAX, SCOUT_USED_STATES, type ScoutDraft, type ScoutResult, type ScoutUsedState } from '../../../../../shared/ai/scout';
import { AI_TEXT, SCOUT_TEXT } from '../../../../../shared/ai/options';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Icon } from '../../../../components/ui/Icon';
import { Notice } from '../../../../components/ui/Notice';
import { Segmented } from '../../../../components/ui/Segmented';
import { DraftEditor } from '../../common/DraftEditor';
import { CharCount } from '../../common/Field';
import { chosenDraft, fmtInt, SCOUT_USED_LABEL, scoutDraftText, withScoutDraft } from '../scoutModel';
import { ScoutAnalysis } from './ScoutAnalysis';

const COMMENT_MAX = 300;
const USAGE_OPTIONS = (['used', 'not_used', 'unknown'] satisfies ScoutUsedState[]).filter((k) => SCOUT_USED_STATES.includes(k)).map((key) => ({ key, label: SCOUT_USED_LABEL[key] }));
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function DraftCard({ draft, result, selected, canEdit, canChoose, choosing, onSave, onChoose }: { draft: ScoutDraft; result: ScoutResult; selected: boolean; canEdit: boolean; canChoose: boolean; choosing: boolean; onSave: (result: ScoutResult) => Promise<void>; onChoose: () => void }) {
  return (
    <article className={`ai-draft-card${selected ? ' selected' : ''}`} aria-label={draft.modelLabel} data-model={draft.modelId} data-selected={selected ? 'true' : undefined}>
      <header>
        <h3>{draft.modelLabel}</h3>
        <span className="muted small num">第 {draft.modelVersion} 版</span>
        {selected ? <Badge tone="good">{SCOUT_TEXT.chosen}</Badge> : null}
      </header>
      <DraftEditor
        parts={[
          { key: 'subject', label: '件名', value: draft.subject, max: SCOUT_SUBJECT_MAX },
          { key: 'body', label: '本文', value: draft.body, multiline: true, max: SCOUT_BODY_MAX },
        ]}
        copyAllText={scoutDraftText(draft)}
        canEdit={canEdit}
        onSave={async (values) => {
          const next = withScoutDraft(result, draft.draftId, { subject: values.subject ?? '', body: values.body ?? '' });
          if (!next.ok) return next.errors;
          await onSave(next.result);
          return null;
        }}
        footer={
          <div className="ai-draft-foot">
            <p className="muted small num">
              件名 {fmtInt(draft.subject.length)} 字・本文 {fmtInt(draft.body.length)} 字・{fmtInt(draft.body.split('\n').length)} 行
            </p>
            <p className="ai-rationale">
              <span className="tag">狙い</span>
              {draft.rationale}
            </p>
            {draft.changes.length ? (
              <div className="ai-changes">
                <span className="tag">主な変更点</span>
                <ul className="ai-list" aria-label="主な変更点">
                  {draft.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        }
      />
      <Button className="choose" variant={selected ? 'default' : 'primary'} aria-pressed={selected} disabled={!canChoose || selected} loading={choosing} title={canChoose ? undefined : '選ぶには Google ログインが必要です'} onClick={onChoose}>
        {selected ? (
          <>
            <Icon name="check" size={14} /> {SCOUT_TEXT.chosen}
          </>
        ) : (
          SCOUT_TEXT.choose
        )}
      </Button>
    </article>
  );
}

/**
 * ② の結果: 分析結果（畳める）→ 3 つの案（モデルごとに 1 枚。コピー・手直し・「この案を選ぶ」）→ 「どれも使わない」とコメント → 選んだ後の「企業が使いましたか？」。
 * result は、元の結果に直した版を重ねたもの（readScoutResult）。onSave には、保存する形（案の件名・本文だけ差し替えたもの）を渡す。
 * 「どれも使わない」を押したことは、結果からは読めないので、この画面を開いている間だけ覚える（親が key = ジョブ ID で作り直す）。
 */
export function ScoutResultView({
  result,
  edited,
  canEdit,
  onSave,
  onClearEdited,
  onChoose,
  onUsage,
}: {
  result: ScoutResult;
  edited: boolean;
  canEdit: boolean;
  onSave: (result: ScoutResult) => Promise<void>;
  onClearEdited?: () => Promise<void>;
  /** どの案を選んだか（null = どれも使わない）とコメントを記録する。失敗したら例外 */
  onChoose: (draftId: string | null, comment: string) => Promise<void>;
  /** 選んだ案を企業が使ったかを記録する。失敗したら例外 */
  onUsage: (usedState: ScoutUsedState) => Promise<void>;
}) {
  const chosen = chosenDraft(result);
  // 記録済みの判断（「どれも使わない」・コメント）は、読み出しの結果（result.choice）から戻す
  const [comment, setComment] = useState(result.choice?.comment ?? '');
  /** 送った後のコメント（同じ内容を送り直さない） */
  const [sentComment, setSentComment] = useState<string | null>(result.choice?.comment ? result.choice.comment : null);
  const [noneChosen, setNoneChosen] = useState(Boolean(result.choice?.none));
  /** 記録の最中（draftId / 'none' / 'comment' / 'usage'） */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const judged = chosen !== null || noneChosen;
  const commentOver = comment.length > COMMENT_MAX;

  const choose = async (draftId: string | null, key: string) => {
    if (commentOver) {
      setError(`コメントは ${COMMENT_MAX} 文字までです`);
      return;
    }
    setPending(key);
    setError(null);
    try {
      await onChoose(draftId, comment.trim());
      setNoneChosen(draftId === null);
      setSentComment(comment.trim());
    } catch (e) {
      setError(msg(e));
    } finally {
      setPending(null);
    }
  };
  const usage = async (state: ScoutUsedState) => {
    setPending('usage');
    setError(null);
    try {
      await onUsage(state);
    } catch (e) {
      setError(msg(e));
    } finally {
      setPending(null);
    }
  };
  const fb = chosen?.feedback ?? null;
  const hasOutcome = fb !== null && fb.sends !== null;

  return (
    <div className="ai-result-body">
      {result.warnings.length ? (
        <Notice tone="warn">
          <b>注意</b>
          {result.warnings.length === 1 ? (
            `: ${result.warnings[0]}`
          ) : (
            <ul className="ai-list">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </Notice>
      ) : null}
      <ScoutAnalysis result={result} />

      <section className="card ai-section" aria-label="3 つの案">
        <div className="card-head">
          <h2>3 つの案</h2>
          {edited ? (
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
                    setError(null);
                    try {
                      await onClearEdited();
                    } catch (e) {
                      setError(msg(e));
                    } finally {
                      setClearing(false);
                    }
                  }}
                >
                  元の案に戻す
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
        <p className="lead">作り方の違う 3 つのモデルが、それぞれ 1 案を作りました。使う案を 1 つ選んでください（選び直せます）。選んだ結果は、モデルの検証と改善に使います</p>
        {error ? (
          <div className="notice error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        <div className="ai-drafts-wrap">
          <div className="ai-drafts" data-count={result.drafts.length}>
            {result.drafts.map((d) => (
              <DraftCard key={d.draftId} draft={d} result={result} selected={chosen?.draftId === d.draftId} canEdit={canEdit} canChoose={canEdit && pending === null} choosing={pending === d.draftId} onSave={onSave} onChoose={() => void choose(d.draftId, d.draftId)} />
            ))}
          </div>
        </div>
        <p className="muted small">{SCOUT_TEXT.placeholders}</p>

        <div className="ai-choice" role="group" aria-label="選択とコメント">
          <div className="ai-field">
            <div className="lbl">
              <label htmlFor="ai-scout-comment">コメント（任意）</label>
            </div>
            <textarea id="ai-scout-comment" className="ctl" rows={2} value={comment} disabled={!canEdit || pending !== null} placeholder="選んだ理由・直してほしい点など（企業名・個人名は書かない）" onChange={(e) => setComment(e.target.value)} />
            <div className="hint">
              {SCOUT_TEXT.commentHint}。<CharCount value={comment} max={COMMENT_MAX} />
            </div>
          </div>
          <div className="acts">
            <Button aria-pressed={noneChosen && !chosen} disabled={!canEdit || pending !== null || (noneChosen && !chosen)} loading={pending === 'none'} onClick={() => void choose(null, 'none')}>
              {SCOUT_TEXT.chooseNone}
            </Button>
            {judged ? (
              <Button variant="ghost" disabled={!canEdit || pending !== null || commentOver || comment.trim() === (sentComment ?? '')} loading={pending === 'comment'} onClick={() => void choose(chosen?.draftId ?? null, 'comment')}>
                コメントを送る
              </Button>
            ) : null}
            {noneChosen && !chosen ? <Badge tone="neutral">「どれも使わない」を記録しました</Badge> : null}
            {sentComment && pending === null && comment.trim() === sentComment ? <span className="muted small">コメントを記録しました</span> : null}
          </div>
        </div>
      </section>

      {chosen && fb ? (
        <section className="card ai-section ai-usage" aria-label="企業の利用">
          <div className="card-head">
            <h2>{SCOUT_TEXT.usageQuestion}</h2>
            <span className="lead">選んだ案: {chosen.modelLabel}</span>
          </div>
          <div className="ai-usage-row">
            <Segmented options={USAGE_OPTIONS.map((o) => ({ ...o, disabled: !canEdit || pending !== null }))} value={fb.usedState} onChange={(s) => void usage(s)} ariaLabel={SCOUT_TEXT.usageQuestion} />
            {fb.usedSource === 'auto' ? <Badge tone="good">送信実績から自動で確認</Badge> : fb.usedSource === 'cs' ? <span className="muted small">画面で記録</span> : null}
          </div>
          {hasOutcome ? (
            <dl className="ai-basis three" aria-label="この案の送信実績">
              <div>
                <dt>送信</dt>
                <dd className="num">
                  {fmtInt(fb.sends ?? 0)}
                  <small> 通</small>
                </dd>
              </div>
              <div>
                <dt>返信</dt>
                <dd className="num">
                  {fmtInt(fb.replies ?? 0)}
                  <small> 件</small>
                </dd>
              </div>
              <div>
                <dt>採用</dt>
                <dd className="num">
                  {fmtInt(fb.hires ?? 0)}
                  <small> 人</small>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted small">送信実績と照合できると、送信・返信・採用の数がここに出ます（照合は自動）</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
