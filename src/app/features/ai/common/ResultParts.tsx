import type { ReactNode } from 'react';
import type { BenchmarkBasis } from '../../../../shared/ai/scout';
import { AI_SEVERITY_LABEL } from '../../../../shared/ai/options';
import { Badge, type Tone } from '../../../components/ui/Badge';
import '../../../styles/ai.css';

/** ②③ の結果で共通の部分（参考にした母集団・上位に共通する特徴・添削の指摘） */

const pct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`);
const int = (v: number): string => v.toLocaleString('ja-JP');

export function ResultSection({ title, lead, children, actions }: { title: string; lead?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card ai-section" aria-label={title}>
      <div className="card-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {lead ? <p className="lead">{lead}</p> : null}
      {children}
    </section>
  );
}

/** 参考にした母集団（どの範囲の、何社・何件を比べたか。上位と全体の率） */
export function BenchmarkBasisView({ basis, rateLabel, sampleLabel }: { basis: BenchmarkBasis; rateLabel: string; sampleLabel: string }) {
  return (
    <ResultSection title="参考にした母集団" lead={basis.scope}>
      <dl className="ai-basis">
        <div>
          <dt>比べた企業</dt>
          <dd className="num">
            {int(basis.companies)}
            <small> 社</small>
          </dd>
        </div>
        <div>
          <dt>{sampleLabel}</dt>
          <dd className="num">
            {int(basis.samples)}
            <small> 件</small>
          </dd>
        </div>
        <div>
          <dt>上位の{rateLabel}</dt>
          <dd className="num strong">{pct(basis.topRatePct)}</dd>
        </div>
        <div>
          <dt>全体の{rateLabel}</dt>
          <dd className="num">{pct(basis.overallRatePct)}</dd>
        </div>
      </dl>
      {basis.caveat ? <p className="ai-caveat">注意: {basis.caveat}</p> : null}
    </ResultSection>
  );
}

export function TraitList({ title, traits }: { title: string; traits: { title: string; body: string }[] }) {
  return (
    <ResultSection title={title}>
      <ol className="ai-traits">
        {traits.map((t, i) => (
          <li key={`${i}-${t.title}`}>
            <b>{t.title}</b>
            <span>{t.body}</span>
          </li>
        ))}
      </ol>
    </ResultSection>
  );
}

type Severity = 'high' | 'mid' | 'low';
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, mid: 1, low: 2 };
const SEVERITY_TONE: Record<Severity, Tone> = { high: 'bad', mid: 'warn', low: 'neutral' };

/** 添削の指摘（重要度の高い順。色は必ず「重要 / 中 / 軽微」の文字と一緒に出す） */
export function ReviewList({ items }: { items: { part: string; severity: Severity; issue: string; suggestion: string }[] }) {
  if (!items.length) return null;
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => SEVERITY_ORDER[a.it.severity] - SEVERITY_ORDER[b.it.severity] || a.i - b.i);
  return (
    <ResultSection title="添削の指摘" lead={`${items.length} 件（重要度の高い順）`}>
      <ul className="ai-review">
        {sorted.map(({ it, i }) => (
          <li key={i} className={`sev-${it.severity}`} data-severity={it.severity}>
            <div className="head">
              <Badge tone={SEVERITY_TONE[it.severity]}>{AI_SEVERITY_LABEL[it.severity]}</Badge>
              <span className="part">{it.part}</span>
            </div>
            <p className="issue">{it.issue}</p>
            <p className="suggestion">
              <span className="tag">直し方</span>
              {it.suggestion}
            </p>
          </li>
        ))}
      </ul>
    </ResultSection>
  );
}
