import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { BoardMeta } from '../../../../shared/schema/board';
import type { ScoredCompany } from '../../../../shared/metrics/score';
import { BOARD_COLUMNS, isNoLogin, type BoardColumn } from '../../../../shared/metrics/board';
import { METRIC_BY_KEY } from '../../../../shared/metrics/definitions';
import { PACE_LABEL } from '../../../../shared/metrics/pace';
import { COMPANY_TYPE_SHORT, CONTRACT_STATE_LABEL, surname, type ContractState } from '../../../../shared/labels';
import { navigate } from '../../../router';
import { prefetch } from '../../../lib/useResource';
import { CompanyDetailResponseSchema } from '../../../../shared/schema/company';
import { fmtInt, fmtMd, fmtRate } from '../../../lib/format';

export const PAGE_SIZE = 200;

/** 0 件で赤く強調する列 */
const ZERO_HIGHLIGHT = new Set(['jobs', 'views', 'apps', 'sent']);

/** セルの主表示（実数）と副情報 */
function cellText(col: BoardColumn, s: ScoredCompany): { value: string; secondary: string | null } {
  const c = s.c;
  switch (col.key) {
    case 'jobs':
      return { value: `${fmtInt(c.m.jobs)} / ${c.limits.job === null ? '–' : fmtInt(c.limits.job)}`, secondary: null };
    case 'views':
      return { value: fmtInt(c.m.views), secondary: null };
    case 'apps':
      return { value: fmtInt(c.m.apps), secondary: null };
    case 'sent':
      return { value: `${fmtInt(c.m.sent)} / ${c.limits.scout === null ? '–' : fmtInt(c.limits.scout)}`, secondary: null };
    case 'intReply':
      return { value: fmtInt(c.m.intReply), secondary: null };
    case 'inSel':
      return { value: fmtInt(c.m.inSel), secondary: null };
    case 'hires':
      return { value: fmtInt(c.m.hires), secondary: null };
    case 'login':
      return { value: c.login.last ? fmtMd(c.login.last) : '記録なし', secondary: null };
    case 'daysToEnd':
      return { value: c.contract.daysToEnd === null ? '無期限' : c.contract.daysToEnd < 0 ? (CONTRACT_STATE_LABEL[c.state as ContractState] ?? '終了') : `${fmtInt(c.contract.daysToEnd)} 日`, secondary: null };
    default:
      return { value: '–', secondary: null };
  }
}

/** 赤く強調するか: 0 件（掲載・閲覧・応募・送信）/ 30 日以上ログインなし */
function isAlert(col: BoardColumn, s: ScoredCompany): boolean {
  const c = s.c;
  if (col.key === 'login') return isNoLogin(c);
  if (!ZERO_HIGHLIGHT.has(col.key)) return false;
  const v = col.key === 'jobs' ? c.m.jobs : col.key === 'views' ? c.m.views : col.key === 'apps' ? c.m.apps : c.m.sent;
  return v === 0;
}

function titleOf(col: BoardColumn, s: ScoredCompany): string {
  const { value, secondary } = cellText(col, s);
  const lines = [`${col.label}: ${value}${secondary ? `（${secondary}）` : ''}`];
  if (col.key === 'sent') lines.push(`消化率 ${s.pace.util === null ? '–' : fmtRate(s.pace.util)}${s.pace.expected === null ? '' : `・期待 ${fmtInt(s.pace.expected)}`}・ペース: ${PACE_LABEL[s.pace.status]}`);
  if (col.key === 'intReply') lines.push('その月に「興味あり」返信があったスカウト数（質問・開封のみは含まない。送信月は問わない）');
  if (col.key === 'login') lines.push(`直近 30 日のログイン日数 ${fmtInt(s.c.login.days30)} 日。CT 画面（2026-05-15 以降）`);
  const def = col.metric ? METRIC_BY_KEY[col.metric] : null;
  if (def) lines.push(`参考: ${def.label} = ${def.formula}`);
  return lines.join('\n');
}

interface Props {
  rows: ScoredCompany[];
  meta: BoardMeta;
  sort: string;
  onSort: (s: string) => void;
}

/** 契約中の企業 × 実績の表。種別・担当・企業名の 3 列は固定。0 件と 30 日以上ログインなしだけ赤 */
export function CompanyBoard({ rows, meta, sort, onSort }: Props) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const groups: { label: string; span: number }[] = [];
  for (const col of BOARD_COLUMNS) {
    const last = groups[groups.length - 1];
    if (last && last.label === col.group) last.span += 1;
    else groups.push({ label: col.group, span: 1 });
  }
  /** 列グループの先頭列（やや濃い区切り線を引く） */
  const groupStart = new Set(BOARD_COLUMNS.filter((col, i) => i === 0 || BOARD_COLUMNS[i - 1].group !== col.group).map((col) => col.key));
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
  const toggleSort = (k: string, defaultDesc = true) => onSort(sortKey === k ? (sortDesc ? k : `-${k}`) : defaultDesc ? `-${k}` : k);
  const sortInd = (k: string) => (sortKey === k ? <span className="sort-ind">{sortDesc ? '▼' : '▲'}</span> : null);
  const ariaSort = (k: string) => (sortKey === k ? (sortDesc ? 'descending' : 'ascending') : undefined);
  const shown = rows.slice(0, limit);
  const loginNote = `CT 画面へのログイン（GA4）。データは ${meta.loginAvailableFrom} 以降のみ。それ以前のログインは「記録なし」になる。前日分は速報値（3 日以内に確定値で置き換え）`;
  return (
    <div className="board-wrap" id="board">
      <table className="board" aria-label="契約企業の実績一覧">
        <thead>
          <tr className="groups">
            <th className="col-type first" scope="colgroup" colSpan={3}>
              企業（{fmtInt(rows.length)} 社）
            </th>
            {groups.map((g) => (
              <th key={g.label} colSpan={g.span} scope="colgroup" className={g.label === '接点' ? 'note' : undefined} title={g.label === '接点' ? loginNote : undefined}>
                {g.label}
              </th>
            ))}
          </tr>
          <tr className="metrics">
            <th className="col-type sortable" scope="col" aria-sort={ariaSort('type')} onClick={() => toggleSort('type', false)}>
              種別{sortInd('type')}
            </th>
            <th className="col-owner sortable" scope="col" aria-sort={ariaSort('owner')} onClick={() => toggleSort('owner', false)}>
              CS 担当{sortInd('owner')}
            </th>
            <th className="company sortable" scope="col" aria-sort={ariaSort('name')} onClick={() => toggleSort('name', false)}>
              企業名{sortInd('name')}
            </th>
            {BOARD_COLUMNS.map((col) => (
              <th key={col.key} className={`num sortable${groupStart.has(col.key) ? ' gs' : ''}`} scope="col" aria-sort={ariaSort(col.key)} onClick={() => toggleSort(col.key)} title={col.key === 'login' ? `${col.label}\n${loginNote}` : col.metric ? `${col.label}\n参考: ${METRIC_BY_KEY[col.metric].label}（${METRIC_BY_KEY[col.metric].formula}）` : col.label}>
                {col.label}
                {sortInd(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => {
            const c = s.c;
            return (
              <tr key={c.id} tabIndex={0} onClick={(e) => onRowClick(e, c.id)} onKeyDown={(e) => onRowKey(e, c.id)} onMouseEnter={() => prefetch(`/api/companies/${c.id}?month=${meta.month}`, CompanyDetailResponseSchema)} aria-label={`${c.name} の詳細を開く`}>
                <td className="col-type" title={c.accountTypes.length > 1 ? `企業種別: ${COMPANY_TYPE_SHORT[c.type] ?? c.type}。アカウント ${c.accountTypes.length}（${c.accountTypes.join('・')}）` : `企業種別: ${COMPANY_TYPE_SHORT[c.type] ?? c.type}`}>
                  <span className="badge neutral">{COMPANY_TYPE_SHORT[c.type] ?? c.type}</span>
                  {c.accountTypes.length > 1 ? <span className="acct-more">+{c.accountTypes.filter((t) => t !== c.type).join('・')}</span> : null}
                </td>
                <td className={`col-owner ${c.isMine ? 'mine' : ''} ${c.owner.name ? '' : 'none'}`} title={c.owner.name ? `担当: ${c.owner.name}${c.owner.src === 'override' ? '（画面で上書き）' : ''}` : '担当未設定'}>
                  {surname(c.owner.name) ?? '未設定'}
                </td>
                <td className={`company${c.contractKind === 'ad' ? ' ad' : ''}`}>
                  <span className="nm" title={c.contractKind === 'ad' ? `${c.name}（広告掲載型）` : c.name}>
                    {c.name}
                  </span>
                </td>
                {BOARD_COLUMNS.map((col) => {
                  const { value, secondary } = cellText(col, s);
                  const alert = isAlert(col, s);
                  const soon = col.key === 'daysToEnd' && c.contract.daysToEnd !== null && c.contract.daysToEnd >= 0 && c.contract.daysToEnd <= 60;
                  return (
                    <td key={col.key} className={`info ${alert ? 'zero' : ''} ${soon ? 'soon' : ''}${groupStart.has(col.key) ? ' gs' : ''}`} title={titleOf(col, s)} data-col={col.key} data-alert={alert ? '1' : undefined}>
                      <div className="heat-in">
                        <span className="heat-v num">{value}</span>
                        {secondary ? <span className="heat-s">{secondary}</span> : null}
                      </div>
                    </td>
                  );
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
