import type { CompanyDetailResponse } from '../../../../shared/schema/company';
import { COMPANY_TYPE_SHORT, CONTRACT_STATE_LABEL, INDUSTRY_SOURCE_LABEL, PLAN_SOURCE_LABEL, type ContractState } from '../../../../shared/labels';
import { NO_LOGIN_DAYS, isNoLogin } from '../../../../shared/metrics/board';
import { fmtMonthJa } from '../../../../shared/calendar/periods';
import { Badge } from '../../../components/ui/Badge';
import { Segmented } from '../../../components/ui/Segmented';
import { Link } from '../../../router';
import { fmtDaysLeft, fmtInt, fmtYmd } from '../../../lib/format';
import type { PeriodSelection } from '../companyModel';

/**
 * 企業ページのヘッダ: 名前・状態・種別・業種・プラン・アカウント・ID、期間（開始月〜終了月）とアカウント種別の切替、
 * その下にカード 3 枚（契約期間 / 契約残 / 最終ログイン）
 */
export function CompanyHeader({ d, sel, onPeriod, onAccount }: { d: CompanyDetailResponse; sel: PeriodSelection; onPeriod: (from: string, to: string) => void; onAccount: (account: string) => void }) {
  const c = d.company;
  const stateTone = c.state === 'active' ? 'good' : c.state === 'ending_30d' || c.state === 'ended_recent' ? 'warn' : c.state === 'ended' ? 'bad' : 'neutral';
  const noLogin = isNoLogin(c);
  const soon = c.contract.daysToEnd !== null && c.contract.daysToEnd >= 0 && c.contract.daysToEnd <= 60;
  const months = [...d.meta.months].reverse();
  const multi = d.accounts.length > 1;
  const accountOptions = [{ key: '', label: '全体' }, ...d.accounts.map((a) => ({ key: a.type, label: a.type, title: a.profiles.map((p) => `${p.name ?? p.id}${p.lang ? `（${p.lang}）` : ''}`).join(' / ') }))];
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
            {multi ? (
              <span className="chip-text" data-testid="accounts-chip" title={d.accounts.map((a) => `${a.type}: ${a.profiles.map((p) => p.name ?? p.id).join(' / ')}`).join('\n')}>
                アカウント {d.accounts.length}（{d.accounts.map((a) => a.type).join('・')}）
              </span>
            ) : null}
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
          <div className="field period" role="group" aria-label="期間">
            <span>期間</span>
            <select className="ctl" value={sel.from} onChange={(e) => onPeriod(e.target.value, e.target.value > sel.to ? e.target.value : sel.to)} aria-label="開始月">
              {months.map((m) => (
                <option key={m} value={m}>
                  {fmtMonthJa(m)}
                </option>
              ))}
            </select>
            <span className="sep">〜</span>
            <select className="ctl" value={sel.to} onChange={(e) => onPeriod(e.target.value < sel.from ? e.target.value : sel.from, e.target.value)} aria-label="終了月">
              {months.map((m) => (
                <option key={m} value={m}>
                  {fmtMonthJa(m)}
                </option>
              ))}
            </select>
          </div>
          {multi ? (
            <div className="field" role="group" aria-label="アカウント">
              <span>アカウント</span>
              <Segmented options={accountOptions} value={sel.account} onChange={onAccount} ariaLabel="アカウント種別の切替" />
            </div>
          ) : null}
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
