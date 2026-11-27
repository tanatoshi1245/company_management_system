import type { MeResponse, MetaResponse } from '../../../shared/schema/me';
import { isoToJstDisplay } from '../../../shared/calendar/periods';
import { Link, navigate, useLocation, type RouteKey } from '../../router';
import { Icon, type IconName } from './Icon';
import { fmtYmd } from '../../lib/format';
import { AI_KIND_LABEL } from '../../../shared/ai/common';
import { getCompanyView, type CompanyView } from '../../lib/companyView';

const NAV: { key: RouteKey[]; to: string; label: string; icon: IconName }[] = [
  { key: ['home', 'company'], to: '/', label: 'ボード', icon: 'home' },
  // 目標（/targets）と 設定（/settings）は 2026-10-27 からメニューに出さない（ページとルートは残す。URL 直打ちで開ける）
  { key: ['scoutUnused'], to: '/scout-unused', label: 'スカウト未利用', icon: 'edit' },
];

/**
 * AI メニュー（docs/AI機能.md。2026-11-25 ユーザー指示: 左のレールにサブメニューを設ける）。
 * 2026-11-27: まずスカウトだけを出す（「AI 分析とレポート生成」「求人の AI 添削」は後の段階。下の aiNavTarget の /ai/report 用の引き継ぎは、そのときに使う）
 */
const AI_NAV: { key: RouteKey; to: string; label: string; icon: IconName }[] = [{ key: 'aiScout', to: '/ai/scout', label: AI_KIND_LABEL.scout, icon: 'mail' }];

/**
 * AI メニューのリンク先。企業ページ（/companies/:id）を開いているときは、その企業を引き継ぐ。
 * 「AI 分析とレポート生成」には、表示している期間・アカウント種別も引き継ぐ（表示中の内容でレポートを作るため）
 */
export function aiNavTarget(to: string, pathname: string, search: string, view: CompanyView | null = null): string {
  const m = /^\/companies\/(\d{1,12})\/?$/.exec(pathname);
  if (!m) return to;
  const cur = new URLSearchParams(search);
  const q = new URLSearchParams({ company: m[1] });
  if (to === '/ai/report') {
    // 企業ページが解決した期間（URL に無い既定の期間を含む）を優先し、無ければ URL の値
    const shown = view && view.companyId === m[1] ? view : null;
    for (const k of ['from', 'to', 'account'] as const) {
      const v = shown ? shown[k] : cur.get(k);
      if (v) q.set(k, v);
    }
  }
  return `${to}?${q.toString()}`;
}

/** 左の固定レール: ブランド・ナビ・AI メニュー・データの鮮度・ログイン者 */
export function LeftRail({ me, meta, active }: { me: MeResponse | null; meta: MetaResponse | null; active: RouteKey | null }) {
  const { pathname, search } = useLocation();
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
      {meta?.ai ? (
      <nav className="rail-nav rail-sub" aria-label="AI メニュー">
        <div className="rail-sub-title">AI メニュー</div>
        {AI_NAV.map((n) => (
          <Link
            key={n.to}
            to={aiNavTarget(n.to, pathname, search, getCompanyView())}
            aria-current={active === n.key ? 'page' : undefined}
            onClick={(e) => {
              // 表示中の期間は企業ページの描画の後に決まるので、押した時点の内容で行き先を決め直す
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              navigate(aiNavTarget(n.to, window.location.pathname, window.location.search, getCompanyView()));
            }}
          >
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
      </nav>
      ) : null}
      {meta?.mock ? (
        <div>
          <span className="ribbon">サンプルデータ</span>
        </div>
      ) : null}
      {meta?.stage === 'staging' ? (
        <div>
          <span className="ribbon warn">テスト環境</span>
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
