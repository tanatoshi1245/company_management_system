import { useState } from 'react';
import type { AiJobSummary, AiKind, AiStatus } from '../../../../shared/ai/common';
import { AI_STATUS_LABEL, AI_TEXT } from '../../../../shared/ai/options';
import { isoToJstDisplay } from '../../../../shared/calendar/periods';
import { Badge, type Tone } from '../../../components/ui/Badge';
import { Notice } from '../../../components/ui/Notice';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useAiHistory } from './aiApi';
import '../../../styles/ai.css';

const STATUS_TONE: Record<AiStatus, Tone> = { queued: 'warn', running: 'navy', done: 'good', failed: 'bad' };

/** 履歴（企業 × 機能。新しい順）。行を押すと、その結果を開く */
export function AiHistory({ companyId, kind, activeId, onSelect, onDelete }: { companyId: string | null; kind: AiKind; activeId: string | null; onSelect: (jobId: string) => void; onDelete?: (jobId: string) => void }) {
  const history = useAiHistory(companyId, kind);
  /** 「消す」を押した行（もう一度押すと消す） */
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!companyId) return <p className="muted small">{AI_TEXT.historyNoCompany}</p>;
  if (history.error) return <Notice tone="error">{history.error.message}</Notice>;
  if (!history.data) return <Skeleton variant="row" rows={3} />;
  const jobs = [...history.data.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!jobs.length) return <p className="muted small">{AI_TEXT.historyEmpty}</p>;
  return (
    <ul className="ai-history" aria-label="これまでの結果">
      {jobs.map((j: AiJobSummary) => (
        <li key={j.id} className={j.id === activeId ? 'active' : ''}>
          <button type="button" className="row" aria-current={j.id === activeId ? 'true' : undefined} onClick={() => onSelect(j.id)}>
            <span className="ttl">{j.title}</span>
            <span className="meta">
              <Badge tone={STATUS_TONE[j.status]}>{AI_STATUS_LABEL[j.status]}</Badge>
              {j.sample ? <Badge tone="warn">{AI_TEXT.sample}</Badge> : null}
              {j.edited ? <Badge tone="navy">{AI_TEXT.edited}</Badge> : null}
              <span className="num">{isoToJstDisplay(j.createdAt) ?? j.createdAt}</span>
              <span>{j.createdBy.split('@')[0]}</span>
            </span>
          </button>
          {onDelete ? (
            confirming === j.id ? (
              <span className="del">
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() => {
                    setConfirming(null);
                    onDelete(j.id);
                  }}
                >
                  消す
                </button>
                <button type="button" className="btn sm ghost" onClick={() => setConfirming(null)}>
                  やめる
                </button>
              </span>
            ) : (
              <span className="del">
                <button type="button" className="btn sm ghost" aria-label={`${j.title} を履歴から消す`} onClick={() => setConfirming(j.id)}>
                  消す
                </button>
              </span>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
