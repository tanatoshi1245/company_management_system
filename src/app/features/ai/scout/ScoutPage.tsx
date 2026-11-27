import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import type { PageProps } from '../../../router';
import { useUrlState } from '../../../lib/urlState';
import { ApiError } from '../../../lib/api';
import { Notice } from '../../../components/ui/Notice';
import { Skeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Segmented } from '../../../components/ui/Segmented';
import type { AiJobDetail } from '../../../../shared/ai/common';
import { SCOUT_TEXT } from '../../../../shared/ai/options';
import { SCOUT_PURPOSES, ScoutInputSchema, type ScoutPurpose, type ScoutResult, type ScoutUsedState } from '../../../../shared/ai/scout';
import { AiPageHeader } from '../common/AiPageHeader';
import { AiBusy, AiJobStatus } from '../common/AiJobStatus';
import { AiHistory } from '../common/AiHistory';
import { putScoutChoice, putScoutUsage, useScoutOptions } from '../common/aiApi';
import { aiErrorMessage, useAiWorkspace } from '../common/useAiWorkspace';
import { useCompanyAutofill } from '../common/useCompanyAutofill';
import { ScoutForm, SCOUT_RUN_LABEL } from './components/ScoutForm';
import { ScoutModelsPanel } from './components/ScoutModelsPanel';
import { ScoutResultView } from './components/ScoutResultView';
import { emptyScoutForm, hasBlockingPii, readScoutResult, scoutFormFromInput, scoutPii, validateScout, withLocalChoice, withLocalUsage, type ScoutForm as ScoutFormState } from './scoutModel';
import '../../../styles/ai.css';

const TABS = ['result', 'models'] as const;
type Tab = (typeof TABS)[number];
const TAB_OPTIONS: { key: Tab; label: string }[] = [
  { key: 'result', label: '結果' },
  { key: 'models', label: 'モデルの成績' },
];

const UrlSchema = z.object({
  /** 企業 ID */
  company: z.string().max(40).default(''),
  /** 開いている結果（ジョブ ID） */
  job: z.string().max(40).default(''),
  purpose: z.enum(SCOUT_PURPOSES).default('template'),
  tab: z.enum(TABS).default('result'),
});
const URL_DEFAULTS = { company: '', job: '', purpose: 'template' as ScoutPurpose, tab: 'result' as Tab };

/** 保存されていない見本への記録（404 / 403）か */
const notStored = (job: AiJobDetail, e: unknown): boolean => job.sample && e instanceof ApiError && (e.status === 404 || e.status === 403);

/**
 * ② スカウト文面の AI 作成（/ai/scout）。左 = 入力と履歴、右 = 結果 / モデルの成績。
 * 目的（作成 / 添削）→ 既存企業 → 求人の内容 → 送る相手の条件 → 実行（Worker が分析して 3 案を作る。十数秒で応答に結果が入る）→
 * 3 つの案から選ぶ → 企業が使ったかを記録する。
 */
export default function ScoutPage(_props: PageProps) {
  const [url, setUrl] = useUrlState(UrlSchema, URL_DEFAULTS);
  const setUrlRef = useRef(setUrl);
  setUrlRef.current = setUrl;
  const companyId = url.company || null;
  const jobId = url.job || null;
  const purpose = url.purpose;
  const setJobId = useCallback((id: string | null) => setUrlRef.current({ job: id ?? '', tab: 'result' }), []);
  const ws = useAiWorkspace({ kind: 'scout', companyId, jobId, setJobId });
  const options = useScoutOptions();

  const [form, setForm] = useState<ScoutFormState>(emptyScoutForm);
  /** 「実行」を 1 度押した後は、誤りを欄の下に出し続ける */
  const [showErrors, setShowErrors] = useState(false);
  const autofill = useCompanyAutofill(companyId, (patch) => setForm((f) => ({ ...f, ...('industry' in patch ? { industry: patch.industry ?? '' } : {}), ...('occupations' in patch ? { jobOccupations: patch.occupations ?? [] } : {}) })));

  const onForm = (patch: Partial<ScoutFormState>) => {
    if ('industry' in patch) autofill.markEdited('industry');
    if ('jobOccupations' in patch) autofill.markEdited('occupations');
    setForm((f) => ({ ...f, ...patch }));
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
    // 応答のジョブは、いまの入力で作ったもの（欄へ入れ直さない）
    filledFrom.current = null;
    if (url.tab !== 'result') setUrl({ tab: 'result' });
    // 狭い画面では結果が入力の下にあるので、見える所まで送る
    const el = resultRef.current;
    if (el && typeof el.scrollIntoView === 'function' && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const ok = await ws.run(validation.input);
    if (ok) setShowErrors(false);
  };

  const resultRef = useRef<HTMLDivElement>(null);
  const job = ws.job;
  const read = useMemo(() => readScoutResult(job), [job]);

  /** 失敗した依頼を、同じ入力でもう一度作る（= 新しい依頼） */
  const retryInput = useMemo(() => {
    if (!job || (job.status !== 'failed' && job.status !== 'queued')) return null;
    const r = ScoutInputSchema.safeParse(job.input);
    return r.success ? r.data : null;
  }, [job]);

  const choose = async (draftId: string | null, comment: string) => {
    if (!job) return;
    try {
      ws.replace(await putScoutChoice(job.id, { draftId, comment }));
    } catch (e) {
      if (notStored(job, e) && read.original) ws.replace({ ...job, result: withLocalChoice(read.original, draftId) });
      else throw new Error(aiErrorMessage(e));
    }
  };
  const usage = async (usedState: ScoutUsedState) => {
    if (!job) return;
    try {
      ws.replace(await putScoutUsage(job.id, { usedState }));
    } catch (e) {
      if (notStored(job, e) && read.original) ws.replace({ ...job, result: withLocalUsage(read.original, usedState) });
      else throw new Error(aiErrorMessage(e));
    }
  };

  return (
    <>
      <AiPageHeader kind="scout" config={ws.config} />
      {ws.error ? <Notice tone="error">{ws.error}</Notice> : null}
      {autofill.error ? <Notice tone="warn">企業の業界・掲載職種を読み込めませんでした（{autofill.error.message}）。手で入力できます</Notice> : null}
      <div className="ai-layout scout">
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
              onForm={onForm}
              defaults={autofill.defaults}
              options={options.data}
              optionsLoading={options.loading}
              optionsError={options.error && !options.data ? options.error.message : null}
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
        <div className="ai-col-result" ref={resultRef}>
          <div className="ai-tabs">
            <Segmented options={TAB_OPTIONS} value={url.tab} onChange={(tab) => setUrl({ tab })} ariaLabel="表示" />
          </div>
          {url.tab === 'models' ? (
            <ScoutModelsPanel />
          ) : (
            <div aria-label="結果" role="region" className="ai-result-body">
              {ws.busy ? (
                <section className="card">
                  <AiBusy message={SCOUT_TEXT.generating} since={ws.busySince} />
                </section>
              ) : ws.jobLoading ? (
                <section className="card">
                  <Skeleton rows={6} />
                </section>
              ) : !job ? (
                <section className="card">
                  <EmptyState title="結果はここに出ます" body={`左で入力して「${SCOUT_RUN_LABEL[purpose]}」を押すと、返信率の高い文面を分析して、3 つの案を作ります（10〜30 秒）。履歴からも開けます`} />
                </section>
              ) : (
                <>
                  <section className="card ai-status-card">
                    <div className="card-head">
                      <h2>{job.title}</h2>
                      <span className="lead">{job.companyName}</span>
                    </div>
                    <AiJobStatus job={job} polling={ws.polling} fireMessage={ws.fireMessage} onRetry={ws.canWrite && retryInput && job.companyId === companyId ? () => void ws.run(retryInput) : undefined} busy={ws.busy} />
                  </section>
                  {job.status === 'done' && read.result ? (
                    <ScoutResultView key={job.id} result={read.result as ScoutResult} edited={read.edited} canEdit={ws.canWrite} onSave={ws.saveEdited} onClearEdited={ws.clearEdited} onChoose={choose} onUsage={usage} />
                  ) : job.status === 'done' ? (
                    <Notice tone="error">結果を読めませんでした（形が想定と違います）。もう一度実行してください</Notice>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
