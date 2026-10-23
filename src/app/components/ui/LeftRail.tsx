import type { MeResponse, MetaResponse } from '../../../shared/schema/me';
import { isoToJstDisplay } from '../../../shared/calendar/periods';
import { Link, type RouteKey } from '../../router';
import { Icon, type IconName } from './Icon';
import { fmtYmd } from '../../lib/format';

const NAV: { key: RouteKey[]; to: string; label: string; icon: IconName }[] = [
  { key: ['home', 'company'], to: '/', label: 'ボード', icon: 'home' },
  { key: ['targets', 'targetForm'], to: '/targets', label: '目標', icon: 'target' },
  { key: ['settings'], to: '/settings', label: '設定', icon: 'settings' },
];

/** 左の固定レール: ブランド・ナビ・データの鮮度・ログイン者 */
export function LeftRail({ me, meta, active }: { me: MeResponse | null; meta: MetaResponse | null; active: RouteKey | null }) {
  return (
    <>
      <div className="rail-brand">
        <img src="/daijob-logo-transparent.png" alt="Daijob" />
        <div>
          <div className="name">契約企業マネジメント</div>
          <div className="sub">CS 向け・契約企業の利用状況</div>
        </div>
      </div>
      <nav className="rail-nav" aria-label="主なページ">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} aria-current={active && n.key.includes(active) ? 'page' : undefined}>
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
      </nav>
      {meta?.mock ? (
        <div>
          <span className="ribbon">サンプルデータ</span>
        </div>
      ) : null}
      {meta ? (
        <div className="rail-fresh" aria-label="データの鮮度">
          <div>
            <b>マート更新</b> <span className="num">{isoToJstDisplay(meta.refreshedAt) ?? '未取得'}</span>
            {meta.refreshStatus === 'error' ? <span className="ribbon bad" style={{ marginLeft: 6 }}>今朝の更新に失敗</span> : null}
          </div>
          <div>
            <b>データ最終日</b> <span className="num">{fmtYmd(meta.dataDate)}</span>
          </div>
          <div>
            <b>営業日</b> <span className="num">{meta.bizDays.elapsed}/{meta.bizDays.total}</span> 経過（{Math.round(meta.bizDays.rate * 100)}%）
          </div>
        </div>
      ) : null}
      <div className="rail-user">
        <span className="who" title={me?.email ?? ''}>
          {me?.email ?? '未ログイン'}
          {me && !me.verified ? '（閲覧のみ）' : ''}
        </span>
        {me?.logoutUrl ? (
          <a href={me.logoutUrl} title="ログアウト">
            <Icon name="logout" />
          </a>
        ) : null}
      </div>
    </>
  );
}
