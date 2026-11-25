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

function Elapsed({ from }: { from: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const label = elapsedLabel(from, now);
  return label ? <span className="num muted">経過 {label}</span> : null;
}

/**
 * ジョブの状態（作成中 / 未起動 / 失敗 / 完了）。
 * running = セッションで作成中 + 経過時間、queued = 立ち上げられなかった理由 + もう一度立ち上げる、failed = 失敗の理由 + もう一度立ち上げる、done = サンプルなら印。
 */
export function AiJobStatus({ job, polling, fireMessage, onRefire, busy }: { job: AiJobDetail | null; polling: boolean; fireMessage?: string | null; onRefire?: () => void; busy?: boolean }) {
  if (!job) return null;
  const session = job.sessionUrl ? (
    <a className="btn sm" href={job.sessionUrl} target="_blank" rel="noreferrer">
      <Icon name="external" size={14} /> {AI_TEXT.openSession}
    </a>
  ) : null;
  const refire = onRefire ? (
    <Button size="sm" variant="primary" loading={busy} onClick={onRefire}>
      <Icon name="refresh" size={14} /> {AI_TEXT.refire}
    </Button>
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
  if (job.status === 'queued') {
    return (
      <div className="ai-status queued" role="alert" data-status="queued">
        <Icon name="warning" />
        <div className="msg">
          <b>{AI_TEXT.queued}</b>
          {fireMessage ?? job.error ? <div className="small">{fireMessage ?? job.error}</div> : null}
        </div>
        <div className="acts">
          {session}
          {refire}
        </div>
      </div>
    );
  }
  if (job.status === 'failed') {
    return (
      <div className="ai-status failed" role="alert" data-status="failed">
        <Icon name="warning" />
        <div className="msg">
          <b>{AI_TEXT.failed}</b>
          <div className="small">{job.error ?? fireMessage ?? '理由は分かりません'}</div>
        </div>
        <div className="acts">
          {session}
          {refire}
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
