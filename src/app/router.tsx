import { lazy, useSyncExternalStore, type ComponentType, type LazyExoticComponent, type MouseEvent, type ReactNode } from 'react';

/**
 * 小さなルータ（History API）。ルートは 6 つだけなのでライブラリは入れない。
 * 画面は React.lazy で分割（ルートごとに 1 チャンク）。
 */
export type RouteKey = 'home' | 'company' | 'targets' | 'targetForm' | 'scoutUnused' | 'settings' | 'help';

export interface PageProps {
  params: Record<string, string>;
}

interface RouteDef {
  key: RouteKey;
  pattern: RegExp;
  names: string[];
}

function def(key: RouteKey, path: string): RouteDef {
  const names: string[] = [];
  const re = path.replace(/:([a-zA-Z]+)/g, (_m, n: string) => {
    names.push(n);
    return '([^/]+)';
  });
  return { key, pattern: new RegExp(`^${re}/?$`), names };
}

export const ROUTES: RouteDef[] = [def('home', '/'), def('company', '/companies/:id'), def('targets', '/targets'), def('targetForm', '/targets/:id'), def('scoutUnused', '/scout-unused'), def('settings', '/settings'), def('help', '/help')];

export const PAGES: Record<RouteKey, LazyExoticComponent<ComponentType<PageProps>>> = {
  home: lazy(() => import('./features/home/HomePage')),
  company: lazy(() => import('./features/company/CompanyPage')),
  targets: lazy(() => import('./features/targets/TargetsListPage')),
  targetForm: lazy(() => import('./features/targets/TargetFormPage')),
  scoutUnused: lazy(() => import('./features/scoutUnused/ScoutUnusedPage')),
  settings: lazy(() => import('./features/settings/SettingsPage')),
  help: lazy(() => import('./features/settings/HelpPage')),
};

export function matchRoute(pathname: string): { key: RouteKey; params: Record<string, string> } | null {
  for (const r of ROUTES) {
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1] ?? '')));
    return { key: r.key, params };
  }
  return null;
}

const NAV_EVENT = 'cms:navigate';

/**
 * スクロール位置の保存・復元（戻る / 進むで直前の画面の位置に戻る）。
 * 位置は history の state に持つ（scroll 中に間引いて保存 + 遷移の直前にも保存）。popstate で復元を予約し、
 * 画面が描けた（高さが足りた）タイミングで useScrollRestore が戻す。ブラウザ既定の復元は内容が非同期に描かれる SPA では効かないので手動
 */
let pendingScrollY: number | null = null;
let scrollSaveTimer: number | null = null;
function saveScroll(): void {
  if (typeof window === 'undefined') return;
  const st = (window.history.state ?? {}) as Record<string, unknown>;
  const y = window.scrollY;
  if (st.scrollY === y) return;
  window.history.replaceState({ ...st, scrollY: y }, '', window.location.pathname + window.location.search);
}
if (typeof window !== 'undefined') {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  window.addEventListener('scroll', () => {
    if (scrollSaveTimer !== null) return;
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = null;
      saveScroll();
    }, 150);
  }, { passive: true });
  window.addEventListener('popstate', () => {
    const st = (window.history.state ?? {}) as Record<string, unknown>;
    pendingScrollY = typeof st.scrollY === 'number' ? st.scrollY : 0;
  });
}
/** 復元待ちの位置を取り出す（1 回だけ） */
export function takePendingScroll(): number | null {
  const y = pendingScrollY;
  pendingScrollY = null;
  return y;
}
function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}
function snapshot(): string {
  return window.location.pathname + window.location.search;
}

export interface Location {
  pathname: string;
  search: string;
}

export function useLocation(): Location {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const i = s.indexOf('?');
  return i === -1 ? { pathname: s, search: '' } : { pathname: s.slice(0, i), search: s.slice(i) };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) {
    // 絞り込みの変更など同じ画面内の URL 更新。保存済みのスクロール位置は引き継ぐ
    window.history.replaceState(window.history.state ?? null, '', to);
  } else {
    saveScroll();
    window.history.pushState(null, '', to);
    window.scrollTo(0, 0);
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function Link({ to, children, className, replace, onClick, ...rest }: { to: string; children: ReactNode; className?: string; replace?: boolean; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void; 'aria-current'?: 'page' | undefined; title?: string }) {
  return (
    <a
      href={to}
      className={className}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
    >
      {children}
    </a>
  );
}
