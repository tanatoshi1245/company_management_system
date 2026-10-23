import { fmtInt, fmtRate } from '../../lib/format';

export interface AttrBar {
  value: string;
  scouts: number;
  share: number;
  replyRate: number | null;
}

/** 属性の内訳の横棒。1 色、幅 = 構成比、右に件数と興味あり返信率。5 件未満は「少数」 */
export function AttributeBars({ rows, maxRows = 12, smallThreshold = 5 }: { rows: AttrBar[]; maxRows?: number; smallThreshold?: number }) {
  const shown = rows.slice(0, maxRows);
  const rest = rows.slice(maxRows);
  const restScouts = rest.reduce((a, r) => a + r.scouts, 0);
  const maxShare = Math.max(0.01, ...shown.map((r) => r.share));
  return (
    <div className="attr-bars" role="list">
      {shown.map((r) => (
        <div className="attr-row" role="listitem" key={r.value}>
          <span className="attr-label" title={r.value}>
            {r.value}
          </span>
          <span className="attr-track">
            <span className="attr-fill" style={{ width: `${(r.share / maxShare) * 100}%` }} />
          </span>
          <span className="attr-num num">
            {fmtInt(r.scouts)}
            <span className="muted"> ({fmtRate(r.share)})</span>
          </span>
          <span className="attr-reply num" title="興味あり返信率">
            {r.scouts < smallThreshold ? <span className="badge neutral">少数</span> : r.replyRate === null ? '–' : fmtRate(r.replyRate, 1)}
          </span>
        </div>
      ))}
      {rest.length ? (
        <div className="attr-row more" role="listitem">
          <span className="attr-label muted">他 {rest.length} 件</span>
          <span className="attr-track" />
          <span className="attr-num num muted">{fmtInt(restScouts)}</span>
          <span className="attr-reply" />
        </div>
      ) : null}
    </div>
  );
}
