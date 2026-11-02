import { useMemo, useState } from 'react';
import type { JobRow, JobsResponse } from '../../../../shared/schema/company';
import { normalizeQuery } from '../../../../shared/metrics/board';
import { Help } from '../../../components/ui/Help';
import { Notice } from '../../../components/ui/Notice';
import { Skeleton } from '../../../components/ui/Skeleton';
import { fmtInt, fmtMd } from '../../../lib/format';

export function jobLabelOf(r: JobRow | null | undefined, key: string): string {
  if (r) return r.title;
  return key === 'direct' ? '企業への直接応募' : `求人 ${key}`;
}

/** 求人タイトルの部分一致（NFKC・小文字・空白除去）。空の検索は全件 */
export function filterJobRows(rows: JobRow[], q: string): JobRow[] {
  const n = normalizeQuery(q);
  return n ? rows.filter((r) => normalizeQuery(r.title).includes(n)) : rows;
}

/**
 * 求人単位の表（期間中の閲覧件数・応募件数。閲覧の多い順）と求人フィルタ。
 * 表の上のテキスト検索で入力のたびに表の行とプルダウンの選択肢が絞られる（予測絞り込み。URL には持たない）。
 * 行クリックか上のプルダウンで求人を選ぶと、同じタブのカード・推移・円グラフと選考状況がその求人の分になる
 */
export function JobsTablePanel({ jobs, state, errorCode, selected, onSelect, range }: { jobs: JobsResponse | null; state: 'loading' | 'error' | 'ready'; errorCode: string | null; selected: string; onSelect: (key: string) => void; range: string }) {
  const rows = jobs?.rows ?? [];
  const [q, setQ] = useState('');
  const shown = useMemo(() => filterJobRows(rows, q), [rows, q]);
  const current = rows.find((r) => r.key === selected) ?? null;
  const searching = normalizeQuery(q).length > 0;
  return (
    <section className="card" aria-label="求人ごとの実績" data-testid="jobs-table">
      <div className="card-head">
        <h2>
          求人ごとの実績 <Help text="選択期間に閲覧か応募があった求人（日英のセットは 1 件。「企業への直接応募」は求人を指定しない応募）。閲覧件数の多い順。行を選ぶと、このタブのカード・推移・円グラフと選考状況がその求人の分になる（スカウトは求人に紐付かないので変わらない）" />
        </h2>
        <span className="lead">
          {range} の分{rows.length ? `・${searching ? `${fmtInt(rows.length)} 件中 ${fmtInt(shown.length)} 件` : `${fmtInt(rows.length)} 件`}` : ''}
        </span>
        <div className="job-filter">
          <input type="search" className="ctl" placeholder="求人タイトルで検索" aria-label="求人タイトルで検索" value={q} onChange={(e) => setQ(e.target.value)} disabled={!rows.length} />
          <label htmlFor="job-filter">求人</label>
          <select id="job-filter" className="ctl" value={selected} onChange={(e) => onSelect(e.target.value)} aria-label="求人フィルタ" disabled={!rows.length && !selected}>
            <option value="">すべて</option>
            {shown.map((r) => (
              <option key={r.key} value={r.key}>
                {r.title}
              </option>
            ))}
            {current && !shown.includes(current) ? <option value={selected}>{current.title}（検索外）</option> : null}
            {selected && !current ? <option value={selected}>{jobLabelOf(null, selected)}（期間内にデータなし）</option> : null}
          </select>
          {selected ? (
            <button type="button" className="btn ghost sm" onClick={() => onSelect('')}>
              解除
            </button>
          ) : null}
        </div>
      </div>
      {state === 'error' ? (
        <Notice tone="warn">{errorCode === 'bq' ? '求人単位のデータを読めません。BigQuery の表 cms_company_job_monthly への読み取り権限（README の「次にユーザーが行う作業」8）が付くと表示されます' : '求人単位のデータを取得できませんでした'}</Notice>
      ) : state === 'loading' && !jobs ? (
        <Skeleton variant="row" rows={4} />
      ) : shown.length ? (
        <div className="table-wrap">
          <table className="data compact jobs" aria-label="求人ごとの実績の表">
            <thead>
              <tr>
                <th>求人タイトル</th>
                <th>掲載期間</th>
                <th className="num">閲覧件数</th>
                <th className="num">応募件数</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} aria-selected={selected === r.key} onClick={() => onSelect(selected === r.key ? '' : r.key)} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), onSelect(selected === r.key ? '' : r.key)) : undefined)} title={r.title}>
                  <td className="title">{r.title}</td>
                  <td className="nowrap muted small">{r.publishFrom ? `${fmtMd(r.publishFrom)}〜${r.publishTo ? fmtMd(r.publishTo) : '掲載中'}` : '–'}</td>
                  <td className="num">{r.direct ? <span className="muted">–</span> : fmtInt(r.views)}</td>
                  <td className="num">{fmtInt(r.apps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length ? (
        <div className="empty">「{q}」に一致する求人はありません</div>
      ) : (
        <div className="empty">この期間に閲覧・応募のあった求人はありません</div>
      )}
    </section>
  );
}
