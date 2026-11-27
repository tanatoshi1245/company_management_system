import { useState } from 'react';
import type { ScoutResult } from '../../../../../shared/ai/scout';
import { Badge } from '../../../../components/ui/Badge';
import { elapsedSecLabel, fmtInt, fmtPct, scoutLangLabel, scoutScopeKind, scoutThresholdText } from '../scoutModel';

const FEATURES_SHOWN = 8;

function Quartile({ label, unit, q }: { label: string; unit: string; q: { p25: number; median: number; p75: number } }) {
  return (
    <div>
      <dt>{label}（中央値）</dt>
      <dd className="num">
        {fmtInt(q.median)}
        <small> {unit}</small>
      </dd>
      <dd className="sub num">
        {fmtInt(q.p25)}〜{fmtInt(q.p75)} {unit}
        <span className="muted">（25〜75%）</span>
      </dd>
    </div>
  );
}

/**
 * 分析結果（畳める。既定は開く）: 分析対象（どの文面を、どう選んだか）→ 数値（文字数・行数・特徴の割合・言語）→ 要点（件名の型・構成・文章量・特徴・避けたいこと）。
 * 数値はすべて Worker が返した値（マートの集計）で、画面は計算しない。
 */
export function ScoutAnalysis({ result }: { result: ScoutResult }) {
  const [open, setOpen] = useState(true);
  const { basis, stats, insight } = result;
  const features = [...stats.features].sort((a, b) => b.sharePct - a.sharePct).slice(0, FEATURES_SHOWN);
  const elapsed = elapsedSecLabel(result.elapsedMs);
  return (
    <section className="card ai-section ai-analysis" aria-label="分析結果">
      <div className="card-head">
        <h2>分析結果</h2>
        <button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '畳む' : '開く'}
        </button>
      </div>
      <p className="ai-summary">{result.summary}</p>
      {open ? (
        <div className="ai-analysis-body">
          <section aria-label="分析対象" className="ai-sub">
            <h3>分析対象</h3>
            <p className="ai-basis-line">
              <Badge tone="navy">{scoutScopeKind(basis)}</Badge>
              <b>{basis.scopeLabel}</b>
              <span>・{scoutThresholdText(basis)}</span>
            </p>
            <dl className="ai-basis">
              <div>
                <dt>企業</dt>
                <dd className="num">
                  {fmtInt(basis.companies)}
                  <small> 社</small>
                </dd>
              </div>
              <div>
                <dt>送信</dt>
                <dd className="num">
                  {fmtInt(basis.sends)}
                  <small> 通</small>
                </dd>
                <dd className="sub num">返信 {fmtInt(basis.replies)} 件</dd>
              </div>
              <div>
                <dt>分析対象の返信率</dt>
                <dd className="num strong">{fmtPct(basis.ratePct)}</dd>
              </div>
              <div>
                <dt>全体の返信率</dt>
                <dd className="num">{fmtPct(basis.overallRatePct)}</dd>
                <dd className="sub">選ぶ前の、同じ範囲・同じ条件</dd>
              </div>
            </dl>
            <p className="ai-meta muted small">
              <span>
                対象期間 <span className="num">{basis.periodFrom}〜{basis.periodTo}</span>
              </span>
              <span>
                データ更新日 <span className="num">{basis.dataDate}</span>
              </span>
              <span>{basis.filtersApplied ? '送る相手の条件で数え直しています' : '送る相手の条件は指定なし'}</span>
              {result.insightCached ? <Badge tone="neutral">保存済みの分析を使用（同じ条件は 1 週間使い回します）</Badge> : null}
              {elapsed ? <span>所要時間 <span className="num">{elapsed}</span></span> : null}
            </p>
            {basis.filtersRelaxed.length ? <p className="ai-caveat">注意: 該当する送信が少ないため、次の条件を外して分析しました: {basis.filtersRelaxed.join('・')}</p> : null}
          </section>

          <section aria-label="数値" className="ai-sub">
            <h3>数値（分析した文面）</h3>
            <dl className="ai-basis three">
              <Quartile label="件名の文字数" unit="字" q={stats.subjectChars} />
              <Quartile label="本文の文字数" unit="字" q={stats.bodyChars} />
              <Quartile label="本文の行数" unit="行" q={stats.lines} />
            </dl>
            {features.length ? (
              <>
                <h4>特徴ごとの割合（その特徴を持つ文面の割合）</h4>
                <ul className="ai-bars" aria-label="特徴ごとの割合">
                  {features.map((f) => (
                    <li key={f.key || f.label} title={`${f.label}: ${fmtPct(f.sharePct)}`}>
                      <span className="lbl">{f.label}</span>
                      <span className="track" aria-hidden="true">
                        <span className="fill" style={{ width: `${Math.max(0, Math.min(100, f.sharePct))}%` }} />
                      </span>
                      <span className="val num">{fmtPct(f.sharePct)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {stats.langs.length ? (
              <p className="ai-meta small" aria-label="言語の割合">
                <span className="muted">言語</span>
                {stats.langs.map((l) => (
                  <span key={l.lang}>
                    {scoutLangLabel(l.lang)} <b className="num">{fmtPct(l.sharePct)}</b>
                  </span>
                ))}
              </p>
            ) : null}
          </section>

          <section aria-label="要点" className="ai-sub">
            <h3>要点</h3>
            <div className="ai-insight">
              <div>
                <h4>件名の型</h4>
                <ul className="ai-list">
                  {insight.subjectPatterns.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <h4>文章量の目安</h4>
                <p>{insight.volume}</p>
              </div>
              <div>
                <h4>本文の構成</h4>
                <ol className="ai-list" aria-label="本文の構成">
                  {insight.structure.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            </div>
            <h4>特徴</h4>
            <ol className="ai-traits" aria-label="特徴">
              {insight.traits.map((t, i) => (
                <li key={`${i}-${t.title}`}>
                  <b>{t.title}</b>
                  <span>{t.body}</span>
                </li>
              ))}
            </ol>
            {insight.avoid.length ? (
              <>
                <h4>避けたいこと</h4>
                <ul className="ai-list avoid" aria-label="避けたいこと">
                  {insight.avoid.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
