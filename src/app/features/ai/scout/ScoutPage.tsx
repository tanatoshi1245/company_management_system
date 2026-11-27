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
import { SCOUT_BASES, SCOUT_PURPOSES, ScoutInputSchema, scoutBasisUsesJob, scoutBasisUsesMember, type ScoutBasisKind, type ScoutJobSummary, type ScoutMemberSummary, type ScoutPurpose, type ScoutResult, type ScoutUsedState } from '../../../../shared/ai/scout';
import { AiPageHeader } from '../common/AiPageHeader';
import { AiBusy, AiJobStatus } from '../common/AiJobStatus';
import { AiHistory } from '../common/AiHistory';
import { fetchScoutJob, fetchScoutMember, putScoutChoice, putScoutUsage, useScoutOptions } from '../common/aiApi';
import { aiErrorMessage, useAiWorkspace } from '../common/useAiWorkspace';
import { useCompanyAutofill } from '../common/useCompanyAutofill';
import { ScoutForm, SCOUT_RUN_LABEL } from './components/ScoutForm';
import { ScoutModelsPanel } from './components/ScoutModelsPanel';
import { ScoutResultTop, ScoutResultView } from './components/ScoutResultView';
import { ScoutTargetView } from './components/ScoutTargetCards';
import { emptyScoutForm, hasBlockingPii, parseScoutId, readScoutResult, scoutFormFromInput, scoutPii, validateScout, withLocalChoice, withLocalUsage, type ScoutForm as ScoutFormState } from './scoutModel';
import { useScoutLookup } from './useScoutLookup';
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
  /** 何をもとに作るか（'' = まだ選んでいない。既定で選んだ状態にしない） */
  basis: z.enum(['', ...SCOUT_BASES]).default(''),
  /** 確かめる求人 ID・会員 ID（「確かめる」を押した ID。開き直すと、もう一度確かめる = AI は動かない） */
  jobId: z.string().max(12).default(''),
  memberId: z.string().max(12).default(''),
});
const URL_DEFAULTS = { company: '', job: '', purpose: 'template' as ScoutPurpose, tab: 'result' as Tab, basis: '' as ScoutBasisKind | '', jobId: '', memberId: '' };
const jobKeyOf = (companyId: string, jobId: string): string => `${companyId}:${jobId}`;

/** 保存されていない見本への記録（404 / 403）か */
const notStored = (job: AiJobDetail, e: unknown): boolean => job.sample && e instanceof ApiError && (e.status === 404 || e.status === 403);

/**
 * ② スカウト文面の AI 作成（/ai/scout）。上の段 = 左 入力と履歴 / 右 結果（分析結果）・モデルの成績、下の段 = 3 つの案（全幅）。
 * 既存企業 → **何をもとに作るか（条件 / 求人 ID / 会員 ID / 求人 ID + 会員 ID。選ぶまで先の欄を出さない）** → 目的（作成 / 添削）→
 * 求人・候補者を確かめる（GET だけ。AI は動かない）→ 実行（ここで初めて AI が動く。Worker が分析して 3 案を作り、十数秒で応答に結果が入る）→
 * 3 つの案から選ぶ → 企業が使ったかを記録する。
 */
export default function ScoutPage(_props: PageProps) {
  const [url, setUrl] = useUrlState(UrlSchema, URL_DEFAULTS);
  const setUrlRef = useRef(setUrl);
  setUrlRef.current = setUrl;
  const companyId = url.company || null;
  const jobId = url.job || null;
  const purpose = url.purpose;
  const basis: ScoutBasisKind | null = url.basis || null;
  const usesJob = basis !== null && scoutBasisUsesJob(basis);
  const usesMember = basis !== null && scoutBasisUsesMember(basis);
  const setJobId = useCallback((id: string | null) => setUrlRef.current({ job: id ?? '', tab: 'result' }), []);
  const ws = useAiWorkspace({ kind: 'scout', companyId, jobId, setJobId });
  const options = useScoutOptions();

  const [form, setForm] = useState<ScoutFormState>(emptyScoutForm);
  /** 「実行」を 1 度押した後は、誤りを欄の下に出し続ける */
  const [showErrors, setShowErrors] = useState(false);
  const autofill = useCompanyAutofill(companyId, (patch) => setForm((f) => ({ ...f, ...('industry' in patch ? { industry: patch.industry ?? '' } : {}), ...('occupations' in patch ? { jobOccupations: patch.occupations ?? [] } : {}) })));

  /* ---- 求人 ID・会員 ID を確かめる（GET だけ。AI は動かない） ---- */
  const [jobText, setJobText] = useState(url.jobId);
  const [memberText, setMemberText] = useState(url.memberId);
  const jobLookup = useScoutLookup<ScoutJobSummary>((key, signal) => {
    const i = key.indexOf(':');
    return fetchScoutJob(key.slice(0, i), key.slice(i + 1), signal);
  }, SCOUT_TEXT.jobNotFound);
  const memberLookup = useScoutLookup<ScoutMemberSummary>((key, signal) => fetchScoutMember(key, signal), SCOUT_TEXT.memberNotFound);
  // いまの入力（企業・ID）と同じものを確かめたときだけ「確かめた」と扱う（ID・企業を変えると、古い内容では実行できない）
  const jobKey = companyId && jobText.trim() ? jobKeyOf(companyId, jobText.trim()) : null;
  const memberKey = memberText.trim() || null;
  const jobState = jobKey !== null && jobLookup.state.key === jobKey ? jobLookup.state : null;
  const memberState = memberKey !== null && memberLookup.state.key === memberKey ? memberLookup.state : null;
  const jobSummary = usesJob && jobState?.status === 'ok' ? jobState.data : null;
  const memberSummary = usesMember && memberState?.status === 'ok' ? memberState.data : null;

  // URL に ID があるとき（共有・再読み込み・履歴から開いた）は、欄に入れて、自動で確かめる
  useEffect(() => {
    if (url.jobId) setJobText(url.jobId);
    if (usesJob && companyId && url.jobId) jobLookup.ensure(jobKeyOf(companyId, url.jobId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesJob, companyId, url.jobId]);
  useEffect(() => {
    if (url.memberId) setMemberText(url.memberId);
    if (usesMember && url.memberId) memberLookup.ensure(url.memberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesMember, url.memberId]);

  const onJobText = (text: string) => {
    setJobText(text);
    jobLookup.reset();
    if (url.jobId) setUrl({ jobId: '' });
  };
  const onMemberText = (text: string) => {
    setMemberText(text);
    memberLookup.reset();
    if (url.memberId) setUrl({ memberId: '' });
  };
  const checkJob = () => {
    if (!companyId) return;
    const r = parseScoutId('job', jobText);
    if (!r.ok) return jobLookup.fail(jobKeyOf(companyId, jobText.trim()), r.error);
    if (r.id !== jobText) setJobText(r.id);
    jobLookup.check(jobKeyOf(companyId, r.id));
    if (url.jobId !== r.id) setUrl({ jobId: r.id });
  };
  const checkMember = () => {
    const r = parseScoutId('member', memberText);
    if (!r.ok) return memberLookup.fail(memberText.trim(), r.error);
    if (r.id !== memberText) setMemberText(r.id);
    memberLookup.check(r.id);
    if (url.memberId !== r.id) setUrl({ memberId: r.id });
  };
  const onBasis = (b: ScoutBasisKind) => setUrl({ basis: b, jobId: scoutBasisUsesJob(b) ? url.jobId : '', memberId: scoutBasisUsesMember(b) ? url.memberId : '' });

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
    // 作り方と ID も、その依頼のものに戻す（URL に入れると、上の effect が自動で確かめ直す = AI は動かない）
    const { basis: b, jobId: jid, memberId: mid } = read.source;
    setJobText(jid ?? '');
    setMemberText(mid ?? '');
    if (loadedJob.companyId !== companyId || read.purpose !== purpose || b !== url.basis || (jid ?? '') !== url.jobId || (mid ?? '') !== url.memberId)
      setUrlRef.current({ company: loadedJob.companyId, purpose: read.purpose, basis: b, jobId: jid ?? '', memberId: mid ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedJob]);

  const companyNames = useMemo(() => [ws.company?.name, ws.job?.companyId === companyId ? ws.job?.companyName : null], [ws.company, ws.job, companyId]);
  const pii = useMemo(() => scoutPii(purpose, form, companyNames, basis ?? 'conditions'), [purpose, form, companyNames, basis]);
  const verifiedJobId = jobSummary ? jobText.trim() : null;
  const verifiedMemberId = memberSummary ? memberText.trim() : null;
  const validation = useMemo(() => validateScout(purpose, form, { basis: basis ?? 'conditions', jobId: verifiedJobId, memberId: verifiedMemberId }), [purpose, form, basis, verifiedJobId, verifiedMemberId]);
  /** 必要な ID が、まだ確かめられていない（実行できない理由） */
  const needJob = usesJob && !jobSummary;
  const needMember = usesMember && !memberSummary;
  const unverified = needJob && needMember ? SCOUT_TEXT.needJobMember : needJob ? SCOUT_TEXT.needJob : needMember ? SCOUT_TEXT.needMember : null;
  const errors: Record<string, string> = showErrors ? { ...validation.errors, ...(companyId ? {} : { company: '企業を選んでください' }) } : {};
  const blocked = hasBlockingPii(pii);
  const blockedReason = !ws.config ? null : !ws.canWrite ? '実行には Google ログインが必要です' : blocked ? '企業名・個人情報を消すと実行できます' : !companyId ? '企業を選んでください' : unverified;
  const canRun = Boolean(ws.config) && ws.canWrite && !blocked && !ws.busy && Boolean(companyId) && basis !== null && unverified === null;

  const run = async () => {
    setShowErrors(true);
    if (!companyId || !basis || unverified || !validation.ok || blocked) return;
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

  const showDrafts = url.tab === 'result' && !ws.busy && !ws.jobLoading && job?.status === 'done' && read.result !== null;

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
              basis={basis}
              onBasis={onBasis}
              job={{ text: jobText, onText: onJobText, onCheck: checkJob, loading: jobState?.status === 'loading', error: usesJob && jobState?.status === 'error' ? jobState.error : null, summary: jobSummary }}
              member={{ text: memberText, onText: onMemberText, onCheck: checkMember, loading: memberState?.status === 'loading', error: usesMember && memberState?.status === 'error' ? memberState.error : null, summary: memberSummary }}
              companies={ws.companies}
              companyId={companyId}
              onCompany={(id) => {
                filledFrom.current = null;
                // 求人は企業に属するので、企業を変えたら求人の確認を消す（ID の文字は残す。もう一度確かめる）
                jobLookup.reset();
                setUrl({ company: id ?? '', job: '', jobId: '' });
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
                  <EmptyState title="結果はここに出ます" body={`左で、何をもとに作るかを選び、入力して「${SCOUT_RUN_LABEL[purpose]}」を押すと、返信率の高い文面を分析して、3 つの案を作ります（10〜30 秒）。履歴からも開けます`} />
                </section>
              ) : (
                <>
                  <section className="card ai-status-card">
                    <div className="card-head">
                      <h2>{job.title}</h2>
                      <span className="lead">{job.companyName}</span>
                    </div>
                    {job.status === 'done' && read.result?.target ? <ScoutTargetView target={read.result.target} /> : null}
                    <AiJobStatus job={job} polling={ws.polling} fireMessage={ws.fireMessage} onRetry={ws.canWrite && retryInput && job.companyId === companyId ? () => void ws.run(retryInput) : undefined} busy={ws.busy} />
                  </section>
                  {job.status === 'done' && read.result ? (
                    <ScoutResultTop result={read.result as ScoutResult} />
                  ) : job.status === 'done' ? (
                    <Notice tone="error">結果を読めませんでした（形が想定と違います）。もう一度実行してください</Notice>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
        {/* 下の段（全幅）: 3 つの案。入力の列の下まで使い、横に 3 枚並べても 1 枚の本文が狭くならないようにする */}
        {showDrafts && job && read.result ? (
          <div className="ai-col-wide">
            <ScoutResultView key={job.id} result={read.result as ScoutResult} edited={read.edited} canEdit={ws.canWrite} onSave={ws.saveEdited} onClearEdited={ws.clearEdited} onChoose={choose} onUsage={usage} />
          </div>
        ) : null}
      </div>
    </>
  );
}
