import { useState } from 'react';
import type { CompanyModel } from '../companyModel';
import { CohortMatrix } from '../../../components/charts/CohortMatrix';
import { Help } from '../../../components/ui/Help';
import { STATUS_SHORT } from '../../../../shared/labels';

export function CohortPanel({ m, initial, onChange }: { m: CompanyModel; initial?: string; onChange?: (t: 'scout' | 'application') => void }) {
  const [tab, setTabState] = useState<'scout' | 'application'>(initial === 'application' ? 'application' : 'scout');
  const setTab = (t: 'scout' | 'application') => {
    setTabState(t);
    onChange?.(t);
  };
  const data = tab === 'scout' ? m.cohort.scout : m.cohort.application;
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          選考の状況（コホート × 現ステータス） <Help text="スカウト = 興味あり返信があった月、応募 = 応募した月で人を束ね、その人たちが今どのステータスにいるかを数える。ステータスは現在値（履歴は持たない）" />
        </h2>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'scout'} className={tab === 'scout' ? 'on' : ''} onClick={() => setTab('scout')}>
          スカウト（興味あり返信月）
        </button>
        <button type="button" role="tab" aria-selected={tab === 'application'} className={tab === 'application' ? 'on' : ''} onClick={() => setTab('application')}>
          応募（応募月）
        </button>
      </div>
      {data.months.length ? <CohortMatrix data={data} labelOf={(s) => STATUS_SHORT[s] ?? s} rowLabel={tab === 'scout' ? '興味あり返信月' : '応募月'} /> : <div className="empty">データがありません</div>}
    </section>
  );
}
