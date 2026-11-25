import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import type { PageProps } from '../../../router';
import { useUrlState } from '../../../lib/urlState';
import { Notice } from '../../../components/ui/Notice';
import { Skeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SCOUT_PURPOSES, type ScoutPurpose } from '../../../../shared/ai/scout';
import type { TargetCondition } from '../../../../shared/ai/options';
import { AiPageHeader } from '../common/AiPageHeader';
import { AiJobStatus } from '../common/AiJobStatus';
import { AiHistory } from '../common/AiHistory';
import { useAiWorkspace } from '../common/useAiWorkspace';
import { useCompanyAutofill } from '../common/useCompanyAutofill';
import { ScoutForm, SCOUT_RUN_LABEL } from './components/ScoutForm';
import { ScoutResultView } from './components/ScoutResultView';
import { emptyScoutForm, hasBlockingPii, readScoutResult, scoutFormFromInput, scoutPii, validateScout, type ScoutForm as ScoutFormState } from './scoutModel';
import '../../../styles/ai.css';

const UrlSchema = z.object({
  /** 企業 ID */
  company: z.string().max(40).default(''),
  /** 開いている結果（ジョブ ID） */
  job: z.string().max(40).default(''),
  purpose: z.enum(SCOUT_PURPOSES).default('review'),
});
const URL_DEFAULTS = { company: '', job: '', purpose: 'review' as ScoutPurpose };

/**
 * ② スカウト文面の AI 添削（/ai/scout）。左 = 入力と履歴、右 = 結果。
 * 目的（添削 / テンプレートの作成）→ 既存企業 → 文面 → 条件 → 実行 → セッションが作成 → 結果を表示（コピー・手直し）。
 */
export default function ScoutPage(_props: PageProps) {
  const [url, setUrl] = useUrlState(UrlSchema, URL_DEFAULTS);
  const setUrlRef = useRef(setUrl);
  setUrlRef.current = setUrl;
  const companyId = url.company || null;
  const jobId = url.job || null;
  const purpose = url.purpose;
  const setJobId = useCallback((id: string | null) => setUrlRef.current({ job: id ?? '' }), []);
  const ws = useAiWorkspace({ kind: 'scout', companyId, jobId, setJobId });

  const [form, setForm] = useState<ScoutFormState>(emptyScoutForm);
  /** 「実行」を 1 度押した後は、誤りを欄の下に出し続ける */
  const [showErrors, setShowErrors] = useState(false);
  const autofill = useCompanyAutofill(companyId, (patch) => setForm((f) => ({ ...f, cond: { ...f.cond, ...patch } })));

  const onCond = (patch: Partial<TargetCondition>) => {
    if ('industry' in patch) autofill.markEdited('industry');
    if ('occupations' in patch) autofill.markEdited('occupations');
    setForm((f) => ({ ...f, cond: { ...f.cond, ...patch } }));
  };

  // 履歴から開いた（URL のジョブを読んだ）ら、そのときの入力を欄に入れる
  const loadedJob = jobId && ws.job && ws.job.id === jobId ? ws.job : null;
  const filledFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedJob || filledFrom.current === loadedJob.id) return;
    filledFrom.current = loadedJob.id;
    const read = scoutFormFromInput(loadedJob.input);
    if (!read) return;
    autofill.keep(loadedJob.companyId);
    setForm(read.form);
    setShowErrors(false);
    if (loadedJob.companyId !== companyId || read.purpose !== purpose) setUrlRef.current({ company: loadedJob.companyId, purpose: read.purpose });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedJob]);

  const companyNames = useMemo(() => [ws.company?.name, ws.job?.companyId === companyId ? ws.job?.companyName : null], [ws.company, ws.job, companyId]);
  const pii = useMemo(() => scoutPii(purpose, form, companyNames), [purpose, form, companyNames]);
  const validation = useMemo(() => validateScout(purpose, form), [purpose, form]);
  const errors: Record<string, string> = showErrors ? { ...validation.errors, ...(companyId ? {} : { company: '企業を選んでください' }) } : {};
  const blocked = hasBlockingPii(pii);
  const blockedReason = !ws.config ? null : !ws.canWrite ? '実行には Google ログインが必要です' : blocked ? '企業名・個人情報を消すと実行できます' : !companyId ? '企業を選んでください' : null;
  const canRun = Boolean(ws.config) && ws.canWrite && !blocked && !ws.busy && Boolean(companyId);

  const run = async () => {
    setShowErrors(true);
    if (!companyId || !validation.ok || blocked) return;
    filledFrom.current = null;
    const ok = await ws.run(validation.input);
    if (ok) setShowErrors(false);
  };

  const read = useMemo(() => readScoutResult(ws.job), [ws.job]);
  const job = ws.job;

  return (
    <>
      <AiPageHeader kind="scout" config={ws.config} />
      {ws.error ? <Notice tone="error">{ws.error}</Notice> : null}
      {autofill.error ? <Notice tone="warn">企業の業界・掲載職種を読み込めませんでした（{autofill.error.message}）。手で入力できます</Notice> : null}
      <div className="ai-layout">
        <div className="ai-col-form">
          <section className="card">
            <ScoutForm
              purpose={purpose}
              onPurpose={(p) => setUrl({ purpose: p })}
              companies={ws.companies}
              companyId={companyId}
              onCompany={(id) => {
                filledFrom.current = null;
                setUrl({ company: id ?? '', job: '' });
              }}
              form={form}
              onForm={(patch) => setForm((f) => ({ ...f, ...patch }))}
              onCond={onCond}
              defaults={autofill.defaults}
              errors={errors}
              pii={pii}
              disabled={ws.busy}
              busy={ws.busy}
              canRun={canRun}
              blockedReason={blockedReason}
              onRun={run}
            />
          </section>
          <section className="card" aria-label="履歴">
            <div className="card-head">
              <h2>履歴</h2>
              <span className="lead">企業ごとに残ります（新しい順）</span>
            </div>
            <AiHistory companyId={companyId} kind="scout" activeId={job?.id ?? null} onSelect={ws.select} onDelete={ws.canWrite ? (id) => void ws.remove(id) : undefined} />
          </section>
        </div>
        <div className="ai-col-result" aria-label="結果" role="region">
          {ws.jobLoading ? (
            <section className="card">
              <Skeleton rows={6} />
            </section>
          ) : !job ? (
            <section className="card">
              <EmptyState title="結果はここに出ます" body={`左で入力して「${SCOUT_RUN_LABEL[purpose]}」を押すと、セッションが作成して、ここに反映されます。履歴からも開けます`} />
            </section>
          ) : (
            <>
              <section className="card ai-status-card">
                <div className="card-head">
                  <h2>{job.title}</h2>
                  <span className="lead">{job.companyName}</span>
                </div>
                <AiJobStatus job={job} polling={ws.polling} fireMessage={ws.fireMessage} onRefire={ws.canWrite ? () => void ws.refire() : undefined} busy={ws.busy} />
              </section>
              {job.status === 'done' && read.result ? (
                <ScoutResultView result={read.result} edited={read.edited} canEdit={ws.canWrite} onSave={ws.saveEdited} onClearEdited={ws.clearEdited} />
              ) : job.status === 'done' ? (
                <Notice tone="error">結果を読めませんでした（形が想定と違います）。もう一度実行してください</Notice>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
