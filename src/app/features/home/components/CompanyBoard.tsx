import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { BoardMeta } from '../../../../shared/schema/board';
import { cellScore, type BenchMode, type ScoredCompany } from '../../../../shared/metrics/score';
import { attentionReason, heatColumns } from '../../../../shared/metrics/board';
import { GROUP_LABEL, METRIC_BY_KEY, type MetricDef } from '../../../../shared/metrics/definitions';
import { BENCH_LEVEL_LABEL } from '../../../../shared/metrics/benchmark';
import { PACE_LABEL } from '../../../../shared/metrics/pace';
import { COMPANY_TYPE_SHORT, CONTRACT_STATE_LABEL, type ContractState } from '../../../../shared/labels';
import { HeatCell } from '../../../components/charts/HeatCell';
import { TimelineBar } from '../../../components/charts/TimelineBar';
import { navigate } from '../../../router';
import { prefetch } from '../../../lib/useResource';
import { CompanyDetailResponseSchema } from '../../../../shared/schema/company';
import { fmtDaysAgo, fmtInt, fmtNum, fmtRate, fmtRatio } from '../../../lib/format';

export const PAGE_SIZE = 200;

function fmtValue(def: MetricDef, v: number | null): string {
  if (v === null) return '–';
  switch (def.unit) {
    case 'rate':
      return fmtRate(v, def.decimals);
    case 'ratio':
      return fmtNum(v, def.decimals);
    default:
      return fmtInt(v);
  }
}

function secondaryOf(key: string, s: ScoredCompany, mode: BenchMode): string | null {
  const c = s.c;
  if (mode === 'target') {
    const t = s.target[key];
    if (!t || t.target === null) return '目標なし';
    return t.expected === null ? `目標 ${fmtInt(t.target)}` : `${fmtInt(t.actual)} / 期待 ${fmtInt(t.expected)}`;
  }
  switch (key) {
    case 'job_utilization':
      return `${fmtInt(c.m.jobs)} / ${c.limits.job === null ? '–' : fmtInt(c.limits.job)}`;
    case 'scout_utilization':
      return c.limits.scout === null ? `${fmtInt(c.m.sent)} 件（枠なし）` : s.pace.expected === null ? `${fmtInt(c.m.sent)} / ${fmtInt(c.limits.scout)}` : `${fmtInt(c.m.sent)} / ${fmtInt(c.limits.scout)}・期待 ${fmtInt(s.pace.expected)}`;
    case 'reply_rate':
      return `${fmtInt(c.m.int)} / ${fmtInt(c.m.sent)}`;
    case 'apps_per_active_job':
      return `応募 ${fmtInt(c.m.apps)}`;
    case 'views_per_active_job':
      return `閲覧 ${fmtInt(c.m.views)}`;
    case 'login_days':
      return c.login.last ? `最終 ${fmtDaysAgo(c.login.last, c.login.last)}`.replace('最終 今日', '直近あり') : '記録なし';
    default:
      return null;
  }
}

function titleOf(def: MetricDef, s: ScoredCompany, mode: BenchMode, v: number | null): string {
  const lines = [`${def.label}: ${fmtValue(def, v)}`];
  if (mode === 'industry') {
    const b = s.bench[def.key];
    if (b && b.median !== null) lines.push(`基準 ${fmtValue(def, b.median)}（${b.group}・${b.n} 社の中央値、${BENCH_LEVEL_LABEL[b.level]}）`, `業界比 ${fmtRatio(b.ratio)}`);
    else if (b) lines.push('基準なし（比較できる企業が足りません）');
  } else {
    const t = s.target[def.key];
    if (t && t.target !== null) lines.push(`目標 ${fmtInt(t.target)} / 期待 ${t.expected === null ? '–' : fmtInt(t.expected)} / 実績 ${fmtInt(t.actual)}`, `達成率 ${fmtRate(t.progress)}`);
    else lines.push('目標が登録されていません');
  }
  if (def.key === 'scout_utilization') lines.push(`ペース: ${PACE_LABEL[s.pace.status]}`);
  lines.push(`式: ${def.formula}`);
  return lines.join('\n');
}

function initials(name: string | null): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
}

interface Props {
  rows: ScoredCompany[];
  mode: BenchMode;
  meta: BoardMeta;
  sort: string;
  onSort: (s: string) => void;
}

/** マトリクス・ヒートマップ。行 = 企業、列 = 指標（グループ見出し付き）、左列は固定 */
export function CompanyBoard({ rows, mode, meta, sort, onSort }: Props) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const columns = heatColumns(mode);
  const defs = columns.map((k) => METRIC_BY_KEY[k]);
  const groups: { label: string; span: number }[] = [];
  for (const d of defs) {
    const last = groups[groups.length - 1];
    if (last && last.label === GROUP_LABEL[d.group]) last.span += 1;
    else groups.push({ label: GROUP_LABEL[d.group], span: 1 });
  }
  const open = (id: string) => navigate(`/companies/${id}?month=${meta.month}`);
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (e.key === 'Enter') open(id);
  };
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, id: string) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    open(id);
  };
  const sortKey = sort.replace(/^-/, '');
  const sortDesc = sort.startsWith('-');
  const toggleSort = (k: string) => onSort(sortKey === k ? (sortDesc ? k : `-${k}`) : `-${k}`);
  const shown = rows.slice(0, limit);
  return (
    <div className="board-wrap" id="board">
      <table className="board" aria-label="契約企業のヒートマップ">
        <thead>
          <tr className="groups">
            <th className="company first" scope="colgroup">
              企業（{fmtInt(rows.length)} 社）
            </th>
            {groups.map((g) => (
              <th key={g.label} colSpan={g.span} scope="colgroup">
                {g.label}
              </th>
            ))}
            <th scope="colgroup" />
          </tr>
          <tr className="metrics">
            <th className="company" scope="col">
              <span className="muted">名前・種別・担当・契約</span>
            </th>
            {defs.map((d) => (
              <th key={d.key} className="num sortable" scope="col" aria-sort={sortKey === d.key ? (sortDesc ? 'descending' : 'ascending') : undefined} onClick={() => toggleSort(d.key)} title={`${d.label}\n${d.formula}`}>
                {d.short}
                {sortKey === d.key ? <span className="sort-ind">{sortDesc ? '▼' : '▲'}</span> : null}
              </th>
            ))}
            <th scope="col">注目</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => {
            const c = s.c;
            const h = s.health[mode];
            const soon = c.contract.daysToEnd !== null && c.contract.daysToEnd >= 0 && c.contract.daysToEnd <= 60;
            return (
              <tr key={c.id} tabIndex={0} onClick={(e) => onRowClick(e, c.id)} onKeyDown={(e) => onRowKey(e, c.id)} onMouseEnter={() => prefetch(`/api/companies/${c.id}?month=${meta.month}`, CompanyDetailResponseSchema)} aria-label={`${c.name} の詳細を開く`}>
                <td className={`company h-${h.level}`}>
                  <div className="co-strip">
                    <span className="nm" title={c.name}>
                      {c.name}
                    </span>
                    <span className={`ava ${c.isMine ? 'mine' : c.owner.name ? '' : 'none'}`} title={c.owner.name ? `担当: ${c.owner.name}${c.owner.src === 'override' ? '（画面で上書き）' : ''}` : '担当未設定'}>
                      {initials(c.owner.name)}
                    </span>
                    <span className="meta">
                      <span className="badge neutral">{COMPANY_TYPE_SHORT[c.type] ?? c.type}</span>
                      <TimelineBar start={c.contract.from} end={c.contract.to} today={meta.asOf} compact />
                      <span className={`days ${soon ? 'soon' : ''}`}>{c.contract.daysToEnd === null ? '無期限' : c.contract.daysToEnd < 0 ? CONTRACT_STATE_LABEL[c.state as ContractState] ?? '終了' : `残 ${c.contract.daysToEnd} 日`}</span>
                    </span>
                  </div>
                </td>
                {defs.map((d) => {
                  const v = s.values[d.key];
                  const isInfo = mode === 'industry' && !d.benchMetric;
                  if (isInfo) {
                    return (
                      <td key={d.key} className="info" title={titleOf(d, s, mode, v)}>
                        <div className="heat-in">
                          <span className="heat-v num">{fmtValue(d, v)}</span>
                        </div>
                      </td>
                    );
                  }
                  const score = cellScore(s, d.key, mode);
                  const pace = d.key === 'scout_utilization' && mode === 'industry' && (s.pace.status === 'behind' || s.pace.status === 'ahead') ? (s.pace.status === 'behind' ? '▼ 遅れ' : '▲ 前倒し') : null;
                  return <HeatCell key={d.key} score={score} value={fmtValue(d, v)} secondary={secondaryOf(d.key, s, mode)} title={titleOf(d, s, mode, v)} polarity={d.polarity} mark={pace} />;
                })}
                <td className="why">{attentionReason(s, mode) ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > limit ? (
        <div className="more-row">
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            さらに表示（残り {fmtInt(rows.length - limit)} 社）
          </button>
        </div>
      ) : null}
    </div>
  );
}
