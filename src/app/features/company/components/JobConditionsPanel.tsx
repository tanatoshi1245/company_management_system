import { useState } from 'react';
import type { JobRow, JobsResponse } from '../../../../shared/schema/company';
import { JOB_CONDITION_LABEL, JOB_CONDITION_TYPES, JOB_LEVEL_ORDER, SALARY_BANDS, type JobConditionType } from '../../../../shared/labels';
import { PieChart, type PieSlice } from '../../../components/charts/PieChart';
import { Help } from '../../../components/ui/Help';
import { Notice } from '../../../components/ui/Notice';
import { Skeleton } from '../../../components/ui/Skeleton';
import { fmtInt } from '../../../lib/format';

const UNSET = '未設定';

/** 求人 1 件 = 1 で数えた内訳。語学レベルは段階の高い順、年収帯は帯の順、他は件数順。未設定は末尾（PieChart の (未入力) 扱い） */
export function jobConditionRows(jobs: JobsResponse | null, type: JobConditionType): PieSlice[] {
  const m = new Map<string, number>();
  for (const r of jobs?.rows ?? []) {
    if (!r.cond) continue;
    const v = r.cond[type] || UNSET;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  const order: readonly string[] | null = type === 'japanese' || type === 'english' ? JOB_LEVEL_ORDER : type === 'salary' ? SALARY_BANDS : null;
  const idx = (v: string) => (order ? (order.indexOf(v) === -1 ? order.length : order.indexOf(v)) : 0);
  return Array.from(m, ([label, value]) => ({ label, value }))
    .sort((a, b) => (a.label === UNSET ? 1 : b.label === UNSET ? -1 : order ? idx(a.label) - idx(b.label) || b.value - a.value : b.value - a.value))
    .map((r) => ({ label: r.label === UNSET ? '(未入力)' : r.label, value: r.value }));
}

/**
 * 掲載した求人の条件（日本語レベル / 英語レベル / 勤務地 / 職種 / 年収幅）。求人ごとの実績の表と同じ応答（/jobs）から、
 * 未選択なら求人 1 件 = 1 で数えた円グラフ（企業への直接応募の行は数えない）、求人フィルタで 1 件を選んでいればその求人の条件を一覧で出す（2026-11-02〜）
 */
export function JobConditionsPanel({ jobs, state, errorCode, range, selected }: { jobs: JobsResponse | null; state: 'loading' | 'error' | 'ready'; errorCode: string | null; range: string; selected: string }) {
  const [type, setType] = useState<JobConditionType>('japanese');
  const rows = jobConditionRows(jobs, type);
  const n = (jobs?.rows ?? []).filter((r) => r.cond).length;
  const one: JobRow | null = selected ? ((jobs?.rows ?? []).find((r) => r.key === selected) ?? null) : null;
  const loading = state === 'loading' && !jobs;
  const failed = state === 'error' && !jobs;
  return (
    <section className="card" aria-label="掲載した求人の条件" data-testid="job-conditions">
      <div className="card-head">
        <h2>
          掲載した求人の条件 <Help text="選択期間に閲覧か応募があった求人（日英のセットは 1 件）の条件の内訳。求人 1 件 = 1。日本語 / 英語レベルは求人に設定された必要レベル、勤務地は 国が日本なら都道府県・それ以外は国名、職種は大分類、年収幅は求人の最低年収（日本円。「経験と能力に基づく」= 応相談、円以外の通貨 = 円以外）。円は同じ大きさで、8% 以上のスライスに構成比を表示。上位 7 件以外は「その他」。求人を選ぶとその求人の条件を一覧で表示" />
        </h2>
        <span className="lead">
          {range} の分{selected ? `・求人: ${one ? one.title : selected === 'direct' ? '企業への直接応募' : `求人 ${selected}`}` : n ? `・${fmtInt(n)} 件` : ''}
        </span>
      </div>
      {selected && !loading && !failed ? (
        one?.cond ? (
          <dl className="kv" data-testid="job-cond-one" aria-label={`${one.title} の条件`}>
            {JOB_CONDITION_TYPES.map((t) => (
              <div key={t}>
                <dt>{JOB_CONDITION_LABEL[t]}</dt>
                <dd>{one.cond![t] || UNSET}</dd>
              </div>
            ))}
          </dl>
        ) : one ? (
          <div className="empty">企業への直接応募には求人の条件がありません</div>
        ) : (
          <div className="empty">この期間にデータが無い求人です</div>
        )
      ) : null}
      {selected && !loading && !failed ? null : (
      <div className="tabs" role="tablist" aria-label="掲載した求人の条件の項目">
        {JOB_CONDITION_TYPES.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
            {JOB_CONDITION_LABEL[t]}
          </button>
        ))}
      </div>
      )}
      {selected && !loading && !failed ? null : loading ? (
        <Skeleton variant="tile" />
      ) : failed ? (
        errorCode === 'bq' ? (
          <Notice tone="warn">求人単位のデータは BigQuery の権限付与待ちです（README の作業 8）</Notice>
        ) : (
          <div className="empty">求人の条件を取得できませんでした</div>
        )
      ) : rows.length ? (
        <PieChart rows={rows} ariaLabel={`${JOB_CONDITION_LABEL[type]} の内訳（掲載した求人）`} unit="件" />
      ) : (
        <div className="empty">この期間に閲覧か応募があった求人がありません</div>
      )}
    </section>
  );
}
