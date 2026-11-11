import { useMemo, useState } from 'react';
import type { JobHot, JobRow, JobsResponse } from '../../../../shared/schema/company';
import { normalizeQuery } from '../../../../shared/metrics/board';
import { HOTJOB_RECORD_START } from '../../../../shared/labels';
import { Help } from '../../../components/ui/Help';
import { Notice } from '../../../components/ui/Notice';
import { Skeleton } from '../../../components/ui/Skeleton';
import { fmtInt, fmtMd } from '../../../lib/format';

export function jobLabelOf(r: JobRow | null | undefined, key: string): string {
  if (r) return r.title;
  return key === 'direct' ? '企業への直接応募' : `求人 ${key}`;
}

/**
 * Hot Job 期間の表示。開始〜期限（開始は観測の前日。記録開始 2026-11-11 より前からの設定は開始日不明）。
 * 最後に観測した日が期限より前で止まっていれば「途中終了」（期限前に外れた / 求人が非アクティブ化）
 */
export function hotJobLabel(h: JobHot | null, dataDate: string): { text: string; note: string | null; title: string } | null {
  if (!h) return null;
  const endedEarly = h.lastSeen < h.to && h.lastSeen < dataDate;
  const end = endedEarly ? h.lastSeen : h.to;
  const text = `${h.from ? fmtMd(h.from) : ''}〜${fmtMd(end)}`;
  const note = endedEarly ? '途中終了' : h.startUnknown ? '開始日不明' : null;
  const title = [h.startUnknown ? `${HOTJOB_RECORD_START} の記録開始時点で設定済み（開始日は不明）` : `開始 ${h.from}（観測の前日）`, `期限 ${h.to}`, endedEarly ? `${h.lastSeen} を最後に観測されず（期限前に外れた / 求人が非アクティブ化）` : null].filter(Boolean).join('。');
  return { text, note, title };
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
export function JobsTablePanel({ jobs, state, errorCode, selected, onSelect, range, dataDate }: { jobs: JobsResponse | null; state: 'loading' | 'error' | 'ready'; errorCode: string | null; selected: string; onSelect: (key: string) => void; range: string; dataDate: string }) {
  const rows = jobs?.rows ?? [];
  const [q, setQ] = useState('');
  const shown = useMemo(() => filterJobRows(rows, q), [rows, q]);
  const current = rows.find((r) => r.key === selected) ?? null;
  const searching = normalizeQuery(q).length > 0;
  return (
    <section className="card" aria-label="求人ごとの実績" data-testid="jobs-table">
      <div className="card-head">
        <h2>
          求人ごとの実績 <Help text="選択期間に閲覧か応募があった求人（日英のセットは 1 件。「企業への直接応募」は求人を指定しない応募）。閲覧件数の多い順。行を選ぶと、このタブのカード・推移・円グラフと選考状況がその求人の分になる（スカウトは求人に紐付かないので変わらない）。Hot Job 期間 = ホットジョブ（上位表示）の設定期間のうち直近 13 か月に掛かる最新の 1 つ（開始〜期限。開始日は毎朝の観測の前日で、記録開始 2026-11-11 より前からの設定は開始日不明。期限より前に外れていれば最後に観測した日まで = 途中終了。延長は新しい期限で 1 つにまとめる）" />
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
                <th className="hot">Hot Job 期間</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} aria-selected={selected === r.key} onClick={() => onSelect(selected === r.key ? '' : r.key)} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), onSelect(selected === r.key ? '' : r.key)) : undefined)} title={r.title}>
                  <td className="title">{r.title}</td>
                  <td className="nowrap muted small">{r.publishFrom ? `${fmtMd(r.publishFrom)}〜${r.publishTo ? fmtMd(r.publishTo) : '掲載中'}` : '–'}</td>
                  <td className="num">{r.direct ? <span className="muted">–</span> : fmtInt(r.views)}</td>
                  <td className="num">{fmtInt(r.apps)}</td>
                  <td className="nowrap hot">
                    {(() => {
                      const h = hotJobLabel(r.hot, dataDate);
                      return h ? (
                        <span title={h.title}>
                          {h.text}
                          {h.note ? <span className="muted small"> {h.note}</span> : null}
                        </span>
                      ) : (
                        <span className="muted">–</span>
                      );
                    })()}
                  </td>
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
