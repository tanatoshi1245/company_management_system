import type { ReactNode } from 'react';
import type { ReportSlide, Tone } from '../../../../../shared/ai/report';
import { SlideFrame } from './SlideFrame';
import { BarsChart, TrendChart } from './charts';

/**
 * layout ごとのスライド（src/shared/ai/report.ts の 9 つの形）。枠は SlideFrame、見た目のクラスは styles/ai-slide.css
 * （slide_creator の表紙・KPI カード・表・手順の箱と同じクラス）。文字の大きさは拡大前の値で書く
 * （13px 以下 = 補足、14〜19px = 本文、20〜27px = 中見出し、28px〜 = 大きな数字。スライド上の大きさは SlideFrame が決める）。
 */

/** 表紙に画面が差し込む内容（セッションは企業名を書かない） */
export interface SlideContext {
  companyName: string;
  from: string;
  to: string;
  /** null = 全体 */
  account: string | null;
  /** 作成日（YYYY-MM-DD） */
  createdOn: string;
  sample: boolean;
}

export const SECTION_LABEL = '利用実績レポート';

type Of<L extends ReportSlide['layout']> = Extract<ReportSlide, { layout: L }>;
interface Common {
  page: number;
  total: number;
  ctx: SlideContext;
}

/** 良し悪しの札（色だけに頼らないよう、必ず言葉を出す） */
export const TONE_LABEL: Record<Tone, string> = { good: '良好', warn: '注意', bad: '課題', neutral: '' };

const ymJa = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
};
const ymdJa = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return d ? `${y}年${Number(m)}月${Number(d)}日` : ymd;
};
export const periodJa = (from: string, to: string) => (from === to ? ymJa(from) : `${ymJa(from)}〜${ymJa(to)}`);

function ToneTag({ tone }: { tone: Tone }) {
  if (tone === 'neutral') return null;
  return (
    <span className={`rs-tone rs-tone--${tone}`} data-testid="tone-tag">
      {TONE_LABEL[tone]}
    </span>
  );
}

/** 本文の下の 1 文（読み取りの補足） */
function Comment({ text }: { text: string }) {
  if (!text) return null;
  return <div className="rs-comment">{text}</div>;
}

function Frame({ c, kicker, lead, children }: { c: Common; kicker: string; lead: string; children: ReactNode }) {
  return (
    <SlideFrame page={c.page} total={c.total} sectionLabel={SECTION_LABEL} kicker={kicker} title={lead} sample={c.ctx.sample}>
      {children}
    </SlideFrame>
  );
}

const cols = (n: number) => (n === 4 ? 2 : n);

function Cover({ s, c }: { s: Of<'cover'>; c: Common }) {
  const { ctx } = c;
  return (
    <SlideFrame page={c.page} total={c.total} sectionLabel={SECTION_LABEL} variant="cover" title={s.title}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
        <p className="kicker" style={{ marginBottom: 28, fontSize: 24 }}>
          Daijob.com · {ymdJa(ctx.createdOn)}
        </p>
        <h1 className="cover-title">{s.title}</h1>
        {ctx.companyName && (
          <div className="cover-sub" data-testid="cover-company">
            {ctx.companyName}
            <span className="dear">御中</span>
          </div>
        )}
        <div className="cover-meta">
          <div>
            <div className="org">ヒューマンリソシア株式会社</div>
            {s.subtitle && <div>{s.subtitle}</div>}
          </div>
          <div style={{ fontSize: 24, alignSelf: 'end' }}>
            <div>対象期間：{periodJa(ctx.from, ctx.to)}</div>
            {ctx.account && <div>アカウント種別：{ctx.account}</div>}
            {ctx.sample && <div>【サンプル】見本のデータによる表示</div>}
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}

function Summary({ s, c }: { s: Of<'summary'>; c: Common }) {
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="rs-rows" style={{ gridTemplateRows: `repeat(${s.points.length}, 1fr)` }}>
        {s.points.map((p, i) => (
          <div key={i} className="card-soft rs-row">
            <div className="rs-row-label">{p.label}</div>
            <div className="rs-row-text">{p.text}</div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function Kpi({ s, c }: { s: Of<'kpi'>; c: Common }) {
  const n = s.cards.length;
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="kpi-grid rs-fill" style={{ gridTemplateColumns: `repeat(${n <= 4 ? n : 3}, 1fr)`, marginBottom: 0 }}>
        {s.cards.map((k, i) => (
          <div key={i} className={`kpi-card rs-kpi rs-edge--${k.tone}`}>
            <div className="rs-kpi-head">
              <div className="kpi-title">{k.label}</div>
              <ToneTag tone={k.tone} />
            </div>
            <div className="kpi-big" style={{ fontSize: n <= 4 ? 48 : 40 }}>
              {k.value}
              {k.unit && (
                <span className="kpi-unit" style={{ fontSize: 17 }}>
                  {k.unit}
                </span>
              )}
            </div>
            {k.note && <div className="kpi-note">{k.note}</div>}
          </div>
        ))}
      </div>
      <Comment text={s.comment} />
    </Frame>
  );
}

function Trend({ s, c }: { s: Of<'trend'>; c: Common }) {
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="chart-panel rs-fill rs-panel">
        <TrendChart slide={s} />
      </div>
      <Comment text={s.comment} />
    </Frame>
  );
}

function Bars({ s, c }: { s: Of<'bars'>; c: Common }) {
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="chart-panel rs-fill rs-panel">
        <BarsChart slide={s} />
      </div>
      <Comment text={s.comment} />
    </Frame>
  );
}

function Table({ s, c }: { s: Of<'table'>; c: Common }) {
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="table-wrap">
        <table className="consult-table" style={{ fontSize: 16 }}>
          <thead>
            <tr>
              {s.columns.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={i}>
                {s.columns.map((_h, j) => (
                  <td key={j} className={j === 0 ? 'rs-td-head' : undefined}>
                    {r[j] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Comment text={s.comment} />
    </Frame>
  );
}

function Findings({ s, c }: { s: Of<'findings'>; c: Common }) {
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="rs-cards rs-fill" style={{ gridTemplateColumns: `repeat(${cols(s.items.length)}, 1fr)` }}>
        {s.items.map((it, i) => (
          <div key={i} className={`card-soft rs-card rs-edge--${it.tone}`}>
            <div className="rs-card-head">
              <div className="rs-card-title">{it.title}</div>
              <ToneTag tone={it.tone} />
            </div>
            <div className="rs-card-body">{it.body}</div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function Proposal({ s, c }: { s: Of<'proposal'>; c: Common }) {
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="step-flow rs-cards rs-fill" style={{ gridAutoFlow: 'row', gridTemplateColumns: `repeat(${cols(s.actions.length)}, 1fr)` }}>
        {s.actions.map((a, i) => (
          <div key={i} className={`step-box rs-card${i === 0 ? ' gold' : ''}`}>
            <div className="rs-card-head" style={{ justifyContent: 'flex-start', alignItems: 'baseline', gap: 12 }}>
              <span className="step-no">{String(i + 1).padStart(2, '0')}</span>
              <div className="rs-card-title">{a.title}</div>
            </div>
            <div className="rs-card-body">{a.body}</div>
            {a.effect && (
              <div className="rs-effect">
                <span className="rs-effect-label">期待できる変化</span>
                <span className="rs-effect-text">{a.effect}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function Next({ s, c }: { s: Of<'next'>; c: Common }) {
  return (
    <Frame c={c} kicker={s.kicker} lead={s.lead}>
      <div className="step-flow rs-fill" style={{ gridAutoFlow: 'row', gridTemplateColumns: `repeat(${s.steps.length}, 1fr)`, gridTemplateRows: 'auto 1fr', columnGap: 14, rowGap: 8 }}>
        {s.steps.map((st, i) => (
          <div key={`w${i}`} className="rs-when" style={{ gridColumn: i + 1, gridRow: 1 }}>
            <span className="num rs-when-no">{String(i + 1).padStart(2, '0')}</span>
            <span className="rs-when-text">{st.when}</span>
          </div>
        ))}
        {s.steps.map((st, i) => (
          <div key={`b${i}`} className={`step-box${i === 0 ? ' gold' : ''}`} style={{ gridColumn: i + 1, gridRow: 2 }}>
            <div className="rs-next-what">{st.what}</div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function SlideBody({ slide, ...c }: Common & { slide: ReportSlide }) {
  switch (slide.layout) {
    case 'cover':
      return <Cover s={slide} c={c} />;
    case 'summary':
      return <Summary s={slide} c={c} />;
    case 'kpi':
      return <Kpi s={slide} c={c} />;
    case 'trend':
      return <Trend s={slide} c={c} />;
    case 'bars':
      return <Bars s={slide} c={c} />;
    case 'table':
      return <Table s={slide} c={c} />;
    case 'findings':
      return <Findings s={slide} c={c} />;
    case 'proposal':
      return <Proposal s={slide} c={c} />;
    case 'next':
      return <Next s={slide} c={c} />;
  }
}
