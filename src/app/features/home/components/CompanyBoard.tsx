import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { BoardMeta } from '../../../../shared/schema/board';
import { cellScore, type BenchMode, type ScoredCompany } from '../../../../shared/metrics/score';
import { BOARD_COLUMNS, type BoardColumn } from '../../../../shared/metrics/board';
import { METRIC_BY_KEY } from '../../../../shared/metrics/definitions';
import { BENCH_LEVEL_LABEL } from '../../../../shared/metrics/benchmark';
import { PACE_LABEL } from '../../../../shared/metrics/pace';
import { COMPANY_TYPE_SHORT, CONTRACT_STATE_LABEL, surname, type ContractState } from '../../../../shared/labels';
import { HeatCell } from '../../../components/charts/HeatCell';
import { TimelineBar } from '../../../components/charts/TimelineBar';
import { navigate } from '../../../router';
import { prefetch } from '../../../lib/useResource';
import { CompanyDetailResponseSchema } from '../../../../shared/schema/company';
import { fmtInt, fmtMd, fmtNum, fmtRate, fmtRatio } from '../../../lib/format';

export const PAGE_SIZE = 200;

function initials(name: string | null): string {
  if (!name) return '–';
  const parts = name.trim().split(/[\s　]+/);
  return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
}

/** セルの主表示（実数）と副情報 */
function cellText(col: BoardColumn, s: ScoredCompany, mode: BenchMode): { value: string; secondary: string | null } {
  const c = s.c;
  const target = (key: string): string | null => {
    const t = s.target[key];
    if (!t || t.target === null) return '目標なし';
    return t.expected === null ? `目標 ${fmtInt(t.target)}` : `期待 ${fmtInt(t.expected)}`;
  };
  switch (col.key) {
    case 'jobs':
      return { value: `${fmtInt(c.m.jobs)} / ${c.limits.job === null ? '–' : fmtInt(c.limits.job)}`, secondary: mode === 'industry' ? (s.values.job_utilization === null ? null : fmtRate(s.values.job_utilization)) : null };
    case 'views':
      return { value: fmtInt(c.m.views), secondary: mode === 'industry' ? (s.values.views_per_active_job === null ? null : `${fmtNum(s.values.views_per_active_job, 0)} / 求人`) : target('views_per_active_job') };
    case 'apps':
      return { value: fmtInt(c.m.apps), secondary: mode === 'industry' ? (s.values.apps_per_active_job === null ? null : `${fmtNum(s.values.apps_per_active_job, 1)} / 求人`) : target('apps_per_active_job') };
    case 'sent': {
      const util = s.pace.util === null ? null : fmtRate(s.pace.util);
      const exp = s.pace.expected === null ? null : `期待 ${fmtInt(s.pace.expected)}`;
      return { value: `${fmtInt(c.m.sent)} / ${c.limits.scout === null ? '–' : fmtInt(c.limits.scout)}`, secondary: mode === 'industry' ? [util, exp].filter(Boolean).join('・') || null : target('scout_utilization') };
    }
    case 'intReply':
      return { value: fmtInt(c.m.intReply), secondary: c.m.int !== c.m.intReply ? `送信月基準 ${fmtInt(c.m.int)}` : null };
    case 'inSel':
      return { value: fmtInt(c.m.inSel), secondary: null };
    case 'hires':
      return { value: fmtInt(c.m.hires), secondary: mode === 'target' ? target('hires') : null };
    case 'login':
      return c.login.last ? { value: fmtMd(c.login.last), secondary: c.login.daysSince === null ? null : c.login.daysSince === 0 ? '今日' : `${c.login.daysSince} 日前・30 日で ${c.login.days30} 日` } : { value: '記録なし', secondary: null };
    case 'daysToEnd':
      return { value: c.contract.daysToEnd === null ? '無期限' : c.contract.daysToEnd < 0 ? (CONTRACT_STATE_LABEL[c.state as ContractState] ?? '終了') : `${fmtInt(c.contract.daysToEnd)} 日`, secondary: c.contract.to ? fmtMd(c.contract.to) : null };
    default:
      return { value: '–', secondary: null };
  }
}

function titleOf(col: BoardColumn, s: ScoredCompany, mode: BenchMode): string {
  const { value, secondary } = cellText(col, s, mode);
  const lines = [`${col.label}: ${value}${secondary ? `（${secondary}）` : ''}`];
  const def = col.metric ? METRIC_BY_KEY[col.metric] : null;
  if (def) {
    const v = s.values[def.key];
    if (mode === 'industry') {
      const b = s.bench[def.key];
      if (b && b.median !== null) lines.push(`${def.label} ${v === null ? '–' : def.unit === 'rate' ? fmtRate(v, def.decimals) : fmtNum(v, def.decimals)}、基準 ${def.unit === 'rate' ? fmtRate(b.median, def.decimals) : fmtNum(b.median, def.decimals)}（${b.group}・${b.n} 社の中央値、${BENCH_LEVEL_LABEL[b.level]}）`, `業界比 ${fmtRatio(b.ratio)}`);
      else if (b) lines.push('基準なし（比較できる企業が足りません）');
    } else {
      const t = s.target[def.key];
      if (t && t.target !== null) lines.push(`目標 ${fmtInt(t.target)} / 期待 ${t.expected === null ? '–' : fmtInt(t.expected)} / 実績 ${fmtInt(t.actual)}`, `達成率 ${fmtRate(t.progress)}`);
      else lines.push('目標が登録されていません');
    }
    if (def.key === 'scout_utilization') lines.push(`ペース: ${PACE_LABEL[s.pace.status]}`);
    lines.push(`式: ${def.formula}`);
  }
  if (col.key === 'intReply') lines.push('その月に「興味あり」返信があったスカウト数（送信月は問わない）');
  return lines.join('\n');
}

interface Props {
  rows: ScoredCompany[];
  mode: BenchMode;
  meta: BoardMeta;
  sort: string;
  onSort: (s: string) => void;
}

/** 企業 × 実績のマトリクス。基準（業界比 / 目標比）がある列はヒートマップの色、それ以外は数値だけ。左列は固定 */
export function CompanyBoard({ rows, mode, meta, sort, onSort }: Props) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const groups: { label: string; span: number }[] = [];
  for (const col of BOARD_COLUMNS) {
    const last = groups[groups.length - 1];
    if (last && last.label === col.group) last.span += 1;
    else groups.push({ label: col.group, span: 1 });
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
  const tinted = (col: BoardColumn): boolean => {
    if (!col.metric) return false;
    const def = METRIC_BY_KEY[col.metric];
    return mode === 'industry' ? Boolean(def.benchMetric) : Boolean(def.targetKey);
  };
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
          </tr>
          <tr className="metrics">
            <th className="company" scope="col">
              <span className="muted">企業名・担当・種別・契約期間</span>
            </th>
            {BOARD_COLUMNS.map((col) => (
              <th key={col.key} className="num sortable" scope="col" aria-sort={sortKey === col.key ? (sortDesc ? 'descending' : 'ascending') : undefined} onClick={() => toggleSort(col.key)} title={col.metric ? `${col.label}\n色: ${METRIC_BY_KEY[col.metric].label}（${METRIC_BY_KEY[col.metric].formula}）` : col.label}>
                {col.label}
                {sortKey === col.key ? <span className="sort-ind">{sortDesc ? '▼' : '▲'}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => {
            const c = s.c;
            const h = s.health[mode];
            return (
              <tr key={c.id} tabIndex={0} onClick={(e) => onRowClick(e, c.id)} onKeyDown={(e) => onRowKey(e, c.id)} onMouseEnter={() => prefetch(`/api/companies/${c.id}?month=${meta.month}`, CompanyDetailResponseSchema)} aria-label={`${c.name} の詳細を開く`}>
                <td className={`company h-${h.level}`}>
                  <div className="co-strip">
                    <span className="nm" title={c.name}>
                      {c.name}
                    </span>
                    <span className="meta">
                      <span className={`ava ${c.isMine ? 'mine' : c.owner.name ? '' : 'none'}`} aria-hidden="true">
                        {initials(c.owner.name)}
                      </span>
                      <span className="own" title={c.owner.name ? `担当: ${c.owner.name}${c.owner.src === 'override' ? '（画面で上書き）' : ''}` : '担当未設定'}>
                        {surname(c.owner.name) ?? '未設定'}
                      </span>
                      <span className="badge neutral" title={`企業種別: ${COMPANY_TYPE_SHORT[c.type] ?? c.type}`}>
                        {COMPANY_TYPE_SHORT[c.type] ?? c.type}
                      </span>
                      <TimelineBar start={c.contract.from} end={c.contract.to} today={meta.asOf} compact />
                    </span>
                  </div>
                </td>
                {BOARD_COLUMNS.map((col) => {
                  const { value, secondary } = cellText(col, s, mode);
                  const title = titleOf(col, s, mode);
                  if (!tinted(col)) {
                    const soon = col.key === 'daysToEnd' && c.contract.daysToEnd !== null && c.contract.daysToEnd >= 0 && c.contract.daysToEnd <= 60;
                    return (
                      <td key={col.key} className={`info ${soon ? 'soon' : ''}`} title={title} data-col={col.key}>
                        <div className="heat-in">
                          <span className="heat-v num">{value}</span>
                          {secondary ? <span className="heat-s">{secondary}</span> : null}
                        </div>
                      </td>
                    );
                  }
                  const def = METRIC_BY_KEY[col.metric!];
                  const score = cellScore(s, def.key, mode);
                  const pace = col.key === 'sent' && mode === 'industry' && (s.pace.status === 'behind' || s.pace.status === 'ahead') ? (s.pace.status === 'behind' ? '▼ 遅れ' : '▲ 前倒し') : null;
                  return <HeatCell key={col.key} score={score} value={value} secondary={secondary} title={title} polarity={def.polarity} mark={pace} />;
                })}
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
