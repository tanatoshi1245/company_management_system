import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import type { PageProps } from '../../../router';
import { useSession } from '../../../lib/session';
import { useUrlState } from '../../../lib/urlState';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Notice } from '../../../components/ui/Notice';
import { Segmented } from '../../../components/ui/Segmented';
import { Skeleton } from '../../../components/ui/Skeleton';
import { AI_ACCOUNT_TYPES } from '../../../../shared/ai/common';
import { findPii, hasBlockingPii } from '../../../../shared/ai/pii';
import { ReportInputSchema } from '../../../../shared/ai/report';
import { fmtMonthJa } from '../../../../shared/calendar/periods';
import { AiHistory } from '../common/AiHistory';
import { AiJobStatus } from '../common/AiJobStatus';
import { AiPageHeader } from '../common/AiPageHeader';
import { CompanyCombobox } from '../common/CompanyCombobox';
import { PiiNotice } from '../common/PiiNotice';
import { useAiWorkspace } from '../common/useAiWorkspace';
import { ReportViewer } from './ReportViewer';
import { monthOptions, readInput, readReport, resolveReportPeriod } from './reportModel';
import '../../../styles/ai-report.css';

const Ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default('');
const UrlSchema = z.object({
  /** 企業 ID（企業ページから引き継ぐ） */
  company: z.string().max(40).default(''),
  /** 期間（企業ページで表示している期間。空 = 当月までの 3 か月） */
  from: Ym,
  to: Ym,
  /** アカウント種別（空 = 全体） */
  account: z.enum(AI_ACCOUNT_TYPES).or(z.literal('')).default(''),
  /** 開いている結果（ジョブ ID） */
  job: z.string().max(40).default(''),
});
const URL_DEFAULTS = { company: '', from: '', to: '', account: '' as const, job: '' };
const ACCOUNT_OPTIONS = [{ key: '' as const, label: '全体' }, ...AI_ACCOUNT_TYPES.map((a) => ({ key: a, label: a }))];
export const REPORT_NOTE_MAX = 500;
export const REPORT_RUN_LABEL = '分析してレポートを作る';

/**
 * ① AI 分析とレポート生成（/ai/report?company=&from=&to=&account=&job=）。
 * 企業・期間・アカウント種別（企業ページから URL で引き継ぐ）と補足だけを送る。数値は Worker が集め直してセッションへ渡す。
 * 結果（スライドの並び）が返ったら、直せるスライドとして表示し、PDF でダウンロードできる。
 */
export default function ReportPage(_props: PageProps) {
  const { meta } = useSession();
  const [url, setUrl] = useUrlState(UrlSchema, URL_DEFAULTS);
  const setUrlRef = useRef(setUrl);
  setUrlRef.current = setUrl;
  const uid = useId();
  const companyId = url.company || null;
  const jobId = url.job || null;
  const setJobId = useCallback((id: string | null) => setUrlRef.current({ job: id ?? '' }), []);
  const ws = useAiWorkspace({ kind: 'report', companyId, jobId, setJobId });
  const [note, setNote] = useState('');

  const months = useMemo(() => (meta ? [...monthOptions(meta.month)].reverse() : []), [meta]);
  const period = useMemo(() => (meta ? resolveReportPeriod(meta.month, url) : null), [meta, url]);
  const setPeriod = (from: string, to: string) => setUrl({ from, to });

  // 履歴から開いた（URL のジョブを読んだ）ら、そのときの企業・期間・アカウント種別・補足を欄に入れる
  const loadedJob = jobId && ws.job && ws.job.id === jobId ? ws.job : null;
  const filledFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedJob || filledFrom.current === loadedJob.id) return;
    filledFrom.current = loadedJob.id;
    const input = readInput(loadedJob);
    if (!input) return;
    setNote(input.note);
    setUrlRef.current({ company: loadedJob.companyId, from: input.from, to: input.to, account: input.account ?? '' });
  }, [loadedJob]);

  const companyNames = useMemo(() => [ws.company?.name, ws.job?.companyId === companyId ? ws.job?.companyName : null], [ws.company, ws.job, companyId]);
  const pii = useMemo(() => findPii(note, companyNames), [note, companyNames]);
  const blocked = hasBlockingPii(pii);
  const noteOver = note.trim().length > REPORT_NOTE_MAX;
  const blockedReason = !ws.config
    ? null
    : !ws.canWrite
      ? '実行には Google ログインが必要です'
      : !companyId
        ? '企業を選んでください'
        : blocked
          ? '企業名・個人情報を消すと実行できます'
          : noteOver
            ? `補足は ${REPORT_NOTE_MAX} 文字までです`
            : null;
  const canRun = Boolean(ws.config) && ws.canWrite && Boolean(companyId) && Boolean(period) && !blocked && !noteOver && !ws.busy;

  const run = async () => {
    if (!canRun || !period) return;
    const input = ReportInputSchema.safeParse({ from: period.from, to: period.to, account: url.account || null, note });
    if (!input.success) return;
    filledFrom.current = null;
    await ws.run(input.data);
  };

  const job = ws.job;
  const read = useMemo(() => readReport(job), [job]);

  return (
    <>
      <AiPageHeader kind="report" config={ws.config} />
      {ws.error ? <Notice tone="error">{ws.error}</Notice> : null}
      <div className="air-top">
        <section className="card">
          <form
            className="air-form"
            aria-label="AI 分析とレポート生成の入力"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div className="air-form-row">
              <div className="air-field air-field--company">
                <label htmlFor={`${uid}-company`}>
                  <span>企業</span>
                </label>
                <CompanyCombobox
                  id={`${uid}-company`}
                  companies={ws.companies}
                  value={companyId}
                  onChange={(id) => {
                    filledFrom.current = null;
                    setUrl({ company: id ?? '', job: '' });
                  }}
                  disabled={ws.busy}
                />
              </div>
              <div className="air-field">
                <label htmlFor={`${uid}-from`}>
                  <span>対象期間</span>
                </label>
                {period ? (
                  <div className="air-period">
                    <select id={`${uid}-from`} className="ctl" aria-label="開始月" value={period.from} disabled={ws.busy} onChange={(e) => setPeriod(e.target.value, e.target.value > period.to ? e.target.value : period.to)}>
                      {months.map((m) => (
                        <option key={m} value={m}>
                          {fmtMonthJa(m)}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden="true">〜</span>
                    <select className="ctl" aria-label="終了月" value={period.to} disabled={ws.busy} onChange={(e) => setPeriod(e.target.value < period.from ? e.target.value : period.from, e.target.value)}>
                      {months.map((m) => (
                        <option key={m} value={m}>
                          {fmtMonthJa(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <Skeleton w={220} h={28} />
                )}
              </div>
              <div className="air-field">
                <label>
                  <span>アカウント種別</span>
                </label>
                <Segmented options={ACCOUNT_OPTIONS} value={url.account} onChange={(a) => setUrl({ account: a })} ariaLabel="アカウント種別" />
              </div>
            </div>
            <div className="air-field">
              <label htmlFor={`${uid}-note`}>
                <span>重点的に見てほしいこと（任意）</span>
                <span className={`num air-count${noteOver ? ' over' : ''}`}>
                  {note.trim().length} / {REPORT_NOTE_MAX}
                </span>
              </label>
              <textarea id={`${uid}-note`} className="ctl" rows={2} value={note} disabled={ws.busy} placeholder="例: スカウトの返信率が下がった理由を中心に" onChange={(e) => setNote(e.target.value)} />
              <div className="air-hint">社名・個人名（担当者・候補者）を書かないでください。数値は、選んだ期間の実績をシステムが集め直して渡します。</div>
            </div>
            <PiiNotice findings={pii} />
            <div className="air-run">
              <Button type="submit" variant="primary" loading={ws.busy} disabled={!canRun}>
                {REPORT_RUN_LABEL}
              </Button>
              {blockedReason ? <span className="muted small">{blockedReason}</span> : <span className="muted small">対象期間の利用状況の分析と、企業へのご提案をスライドにまとめます</span>}
            </div>
          </form>
        </section>
        <section className="card" aria-label="履歴">
          <div className="card-head">
            <h2>履歴</h2>
            <span className="lead">企業ごとに残ります（新しい順）</span>
          </div>
          <AiHistory companyId={companyId} kind="report" activeId={job?.id ?? null} onSelect={ws.select} onDelete={ws.canWrite ? (id) => void ws.remove(id) : undefined} />
        </section>
      </div>
      <div aria-label="結果" role="region">
        {ws.jobLoading ? (
          <section className="card">
            <Skeleton rows={6} />
          </section>
        ) : !job ? (
          <section className="card">
            <EmptyState title="スライドはここに出ます" body={`企業と期間を選んで「${REPORT_RUN_LABEL}」を押すと、セッションが分析してスライドを作り、ここに反映されます（数分かかります）。履歴からも開けます`} />
          </section>
        ) : (
          <>
            <section className="card ai-status-card">
              <div className="card-head">
                <h2>{job.title}</h2>
                <span className="lead">{job.companyName}</span>
              </div>
              <AiJobStatus job={job} polling={ws.polling} fireMessage={ws.fireMessage} />
              {job.status === 'done' && read ? <p className="air-summary">{read.result.summary}</p> : null}
            </section>
            {job.status === 'done' && read ? (
              <ReportViewer job={job} result={read.result} edited={read.edited} canEdit={ws.canWrite} onSave={ws.saveEdited} onClearEdited={ws.clearEdited} />
            ) : job.status === 'done' ? (
              <Notice tone="error">結果を読めませんでした（形が想定と違います）。もう一度実行してください</Notice>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
