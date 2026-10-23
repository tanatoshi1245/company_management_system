import { lazy, useSyncExternalStore, type ComponentType, type LazyExoticComponent, type MouseEvent, type ReactNode } from 'react';

/**
 * 小さなルータ（History API）。ルートは 6 つだけなのでライブラリは入れない。
 * 画面は React.lazy で分割（ルートごとに 1 チャンク）。
 */
export type RouteKey = 'home' | 'company' | 'targets' | 'targetForm' | 'settings' | 'help';

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

export const ROUTES: RouteDef[] = [def('home', '/'), def('company', '/companies/:id'), def('targets', '/targets'), def('targetForm', '/targets/:id'), def('settings', '/settings'), def('help', '/help')];

export const PAGES: Record<RouteKey, LazyExoticComponent<ComponentType<PageProps>>> = {
  home: lazy(() => import('./features/home/HomePage')),
  company: lazy(() => import('./features/company/CompanyPage')),
  targets: lazy(() => import('./features/targets/TargetsListPage')),
  targetForm: lazy(() => import('./features/targets/TargetFormPage')),
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
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
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
