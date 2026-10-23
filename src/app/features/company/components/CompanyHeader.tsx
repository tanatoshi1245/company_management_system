import type { CompanyDetailResponse } from '../../../../shared/schema/company';
import { COMPANY_TYPE_SHORT, CONTRACT_STATE_LABEL, INDUSTRY_SOURCE_LABEL, OWNER_SOURCE_LABEL, PLAN_SOURCE_LABEL, type ContractState } from '../../../../shared/labels';
import { fmtMonthJa, isoToJstDisplay } from '../../../../shared/calendar/periods';
import { TimelineBar } from '../../../components/charts/TimelineBar';
import { Badge } from '../../../components/ui/Badge';
import { Icon } from '../../../components/ui/Icon';
import { Link } from '../../../router';
import { fmtDaysAgo, fmtDaysLeft, fmtInt, fmtYmd } from '../../../lib/format';

export function CompanyHeader({ d, onMonth, onEditOwner }: { d: CompanyDetailResponse; onMonth: (m: string) => void; onEditOwner: () => void }) {
  const c = d.company;
  const x = d.extra;
  const stateTone = c.state === 'active' ? 'good' : c.state === 'ending_30d' || c.state === 'ended_recent' ? 'warn' : c.state === 'ended' ? 'bad' : 'neutral';
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
      <div className="co-facts">
        <div className="fact">
          <span className="k">担当 CS</span>
          <span className="v">
            {c.owner.name ?? <span className="muted">未設定</span>}
            {c.owner.src === 'override' ? <span className="muted small"> （画面で上書き。SF: {c.sfOwnerName ?? '–'}）</span> : c.owner.src !== 'none' ? <span className="muted small"> （{OWNER_SOURCE_LABEL[c.owner.src] ?? c.owner.src}{x.sfAccountOwner.position ? `・${x.sfAccountOwner.position}` : ''}）</span> : null}
            <button type="button" className="btn ghost sm" onClick={onEditOwner} title="担当を上書き">
              <Icon name="edit" size={14} /> 変更
            </button>
          </span>
        </div>
        <div className="fact">
          <span className="k">営業担当（Daijob）</span>
          <span className="v">{c.salesStaff ?? <span className="muted">未設定</span>}</span>
        </div>
        <div className="fact">
          <span className="k">最終ログイン（CT）</span>
          <span className="v">
            {c.login.last ? (
              <>
                {fmtDaysAgo(c.login.last, d.meta.asOf)} <span className="muted small">（{fmtYmd(c.login.last)}・30 日で {fmtInt(c.login.days30)} 日・90 日で {fmtInt(x.login.days90)} 日）</span>
              </>
            ) : (
              <span className="muted">記録なし（2026-05-15 以降のデータ）</span>
            )}
          </span>
        </div>
        <div className="fact">
          <span className="k">Salesforce</span>
          <span className="v">
            {c.signals.sfLinked ? (
              <>
                {x.sfAccountName ?? '–'} <span className="muted small">（契約 {x.sfContractStatus ?? '–'}{x.sfContractStart ? `・${fmtYmd(x.sfContractStart)} 〜 ${x.sfContractEnd ? fmtYmd(x.sfContractEnd) : '–'}` : ''}）</span>
              </>
            ) : (
              <span className="muted">未紐付け（DJ_company_id__c なし）</span>
            )}
            {c.signals.noticeCheck ? <Badge tone="warn">接触中</Badge> : null}
          </span>
        </div>
      </div>
      <div className="co-timeline">
        <div className="co-timeline-head">
          <span>
            契約期間 <b className="num">{fmtYmd(c.contract.from)}</b> 〜 <b className="num">{c.contract.to ? fmtYmd(c.contract.to) : '無期限'}</b>
          </span>
          <span className={`num ${c.contract.daysToEnd !== null && c.contract.daysToEnd >= 0 && c.contract.daysToEnd <= 60 ? 'warn-text' : ''}`}>{fmtDaysLeft(c.contract.daysToEnd)}</span>
        </div>
        <TimelineBar start={c.contract.from} end={c.contract.to} today={d.meta.asOf} />
        <div className="co-signals small muted">
          契約中の根拠: <Badge tone={c.signals.dj ? 'good' : 'neutral'}>Daijob 契約期間</Badge> <Badge tone={c.signals.sfActive ? 'good' : 'neutral'}>SF 有効契約</Badge> <Badge tone={c.signals.sfWon ? 'good' : 'neutral'}>SF 成立商談</Badge> <Badge tone={c.signals.da ? 'good' : 'neutral'}>DA 掲載中</Badge>
          {d.meta.cached ? null : null}
          <span style={{ marginLeft: 8 }}>マート更新 {isoToJstDisplay(d.meta.generatedAt) ?? ''}</span>
        </div>
      </div>
    </header>
  );
}
