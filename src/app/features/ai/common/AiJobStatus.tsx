import { useEffect, useState } from 'react';
import type { AiJobDetail } from '../../../../shared/ai/common';
import { AI_TEXT } from '../../../../shared/ai/options';
import { isoToJstDisplay } from '../../../../shared/calendar/periods';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';
import '../../../styles/ai.css';

/** 経過時間（「3 分 12 秒」）。from が読めないときは null */
export function elapsedLabel(fromIso: string, now: number): string | null {
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return null;
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m} 分 ${sec % 60} 秒` : `${sec} 秒`;
}

/** 1 秒ごとに進む経過時間（from = ISO の日時か、ミリ秒） */
export function Elapsed({ from }: { from: string | number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const label = elapsedLabel(typeof from === 'number' ? new Date(from).toISOString() : from, now);
  return label ? <span className="num muted">経過 {label}</span> : null;
}

/** 実行中（応答を待っている間）の表示。② スカウトは、この間に Worker が分析と作成をしている */
export function AiBusy({ message, since }: { message: string; since: number | null }) {
  return (
    <div className="ai-status running" role="status" aria-live="polite" data-status="busy">
      <span className="ai-spinner on" aria-hidden="true" />
      <div className="msg">
        <b>{message}</b>
        {since !== null ? (
          <div className="small">
            <Elapsed from={since} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ジョブの状態。
 * failed（と、作れないまま残った queued）= 理由 + 「もう一度作る」（onRetry。同じ入力で新しく依頼する）、
 * running = 作成中のまま残っているジョブ（経過時間）、done = 日時と作成した人（見本・直した版の印）。
 */
export function AiJobStatus({ job, polling = false, fireMessage, onRetry, busy }: { job: AiJobDetail | null; polling?: boolean; fireMessage?: string | null; onRetry?: () => void; busy?: boolean }) {
  if (!job) return null;
  const session = job.sessionUrl ? (
    <a className="btn sm" href={job.sessionUrl} target="_blank" rel="noreferrer">
      <Icon name="external" size={14} /> {AI_TEXT.openSession}
    </a>
  ) : null;
  if (job.status === 'running') {
    return (
      <div className="ai-status running" role="status" aria-live="polite" data-status="running">
        <span className={`ai-spinner${polling ? ' on' : ''}`} aria-hidden="true" />
        <div className="msg">
          <b>{AI_TEXT.running}</b>
          <div className="small">
            <Elapsed from={job.createdAt} />
          </div>
        </div>
        <div className="acts">{session}</div>
      </div>
    );
  }
  if (job.status === 'failed' || job.status === 'queued') {
    return (
      <div className="ai-status failed" role="alert" data-status={job.status}>
        <Icon name="warning" />
        <div className="msg">
          <b>{AI_TEXT.failed}</b>
          <div className="small">{job.error ?? fireMessage ?? '理由は分かりません'}</div>
        </div>
        <div className="acts">
          {session}
          {onRetry ? (
            <Button size="sm" variant="primary" loading={busy} onClick={onRetry}>
              <Icon name="refresh" size={14} /> {AI_TEXT.retry}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="ai-status done" data-status="done">
      <div className="msg small muted">
        {job.sample ? <Badge tone="warn">{AI_TEXT.sample}</Badge> : null}
        {job.edited ? <Badge tone="navy">{AI_TEXT.edited}</Badge> : null}
        <span>
          {isoToJstDisplay(job.completedAt ?? job.createdAt) ?? ''} ・ {job.createdBy.split('@')[0]}
        </span>
      </div>
      <div className="acts">{session}</div>
    </div>
  );
}
