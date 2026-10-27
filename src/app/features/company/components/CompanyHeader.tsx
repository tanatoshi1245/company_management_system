import type { CompanyDetailResponse } from '../../../../shared/schema/company';
import { COMPANY_TYPE_SHORT, CONTRACT_STATE_LABEL, INDUSTRY_SOURCE_LABEL, PLAN_SOURCE_LABEL, type ContractState } from '../../../../shared/labels';
import { NO_LOGIN_DAYS, isNoLogin } from '../../../../shared/metrics/board';
import { fmtMonthJa } from '../../../../shared/calendar/periods';
import { Badge } from '../../../components/ui/Badge';
import { Link } from '../../../router';
import { fmtDaysLeft, fmtInt, fmtYmd } from '../../../lib/format';

/** 企業ページのヘッダ: 名前・状態・種別・業種・プラン・ID、月セレクタ、その下にカード 3 枚（契約期間 / 契約残 / 最終ログイン） */
export function CompanyHeader({ d, onMonth }: { d: CompanyDetailResponse; onMonth: (m: string) => void }) {
  const c = d.company;
  const stateTone = c.state === 'active' ? 'good' : c.state === 'ending_30d' || c.state === 'ended_recent' ? 'warn' : c.state === 'ended' ? 'bad' : 'neutral';
  const noLogin = isNoLogin(c);
  const soon = c.contract.daysToEnd !== null && c.contract.daysToEnd >= 0 && c.contract.daysToEnd <= 60;
  return (
    <header className="co-head card">
      <div className="co-head-top">
        <div className="co-title">
          <div className="breadcrumb">
            <Link to={`/?month=${d.meta.month}`}>ボード</Link> / 企業
          </div>
          <h1>{c.name}</h1>
          <div className="co-chips">
            <Badge tone={stateTone}>{CONTRACT_STATE_LABEL[c.state as ContractState] ?? c.state}</Badge>
            <Badge tone="navy">{COMPANY_TYPE_SHORT[c.type] ?? c.type}</Badge>
            <span className="chip-text" title={`業種の出所: ${INDUSTRY_SOURCE_LABEL[c.indSrc] ?? c.indSrc}`}>
              {c.ind}
            </span>
            {c.plan ? (
              <span className="chip-text" title={`プランの出所: ${PLAN_SOURCE_LABEL[c.planSrc] ?? c.planSrc}`}>
                {c.plan}
              </span>
            ) : null}
            <span className="chip-text muted">ID {c.id}</span>
          </div>
        </div>
        <div className="co-head-actions">
          <label className="field">
            <span>月</span>
            <select className="ctl" value={d.meta.month} onChange={(e) => onMonth(e.target.value)} aria-label="表示する月">
              {[...d.meta.months].reverse().map((m) => (
                <option key={m} value={m}>
                  {fmtMonthJa(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="co-cards" aria-label="契約と接点">
        <div className="stat" data-stat="contractPeriod">
          <span className="t">契約期間</span>
          <span className="v num period">
            {fmtYmd(c.contract.from)} <span className="u">〜</span> {c.contract.to ? fmtYmd(c.contract.to) : '無期限'}
          </span>
        </div>
        <div className={`stat${soon ? ' soon' : ''}`} data-stat="daysToEnd">
          <span className="t">契約終了まで</span>
          <span className="v num">{fmtDaysLeft(c.contract.daysToEnd)}</span>
        </div>
        <div className={`stat${noLogin ? ' zero' : ''}`} data-stat="lastLogin" title={`CT 画面へのログイン（GA4）。データは ${d.meta.loginAvailableFrom} 以降のみ。${NO_LOGIN_DAYS} 日以上ログインなし（記録なしを含む）は赤。直近 30 日のログイン日数 ${fmtInt(c.login.days30)} 日`}>
          <span className="t">最終ログイン（CT）</span>
          <span className="v num">{c.login.last ? fmtYmd(c.login.last) : '記録なし'}</span>
        </div>
      </div>
    </header>
  );
}
