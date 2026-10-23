import { Suspense } from 'react';
import { ApiError } from './lib/api';
import { SessionProvider, useSession } from './lib/session';
import { matchRoute, PAGES, useLocation } from './router';
import { AppShell } from './components/ui/AppShell';
import { LeftRail } from './components/ui/LeftRail';
import { Skeleton } from './components/ui/Skeleton';
import { Notice } from './components/ui/Notice';
import { EmptyState } from './components/ui/EmptyState';

function Shell() {
  const { me, meta, loading, error, reload } = useSession();
  const { pathname } = useLocation();
  const route = matchRoute(pathname);

  if (error instanceof ApiError && error.status === 401) {
    return (
      <div className="screen-center login-screen">
        <h1>ログインしてください</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          会社の Google アカウント（@daijob.com）でログインすると、契約企業の利用状況を見られます。
        </p>
        <a className="btn primary" href={error.login ?? '/auth/login'}>
          Google でログイン
        </a>
      </div>
    );
  }

  const Page = route ? PAGES[route.key] : null;
  return (
    <AppShell rail={<LeftRail me={me} meta={meta} active={route?.key ?? null} />}>
      {error ? (
        <Notice tone="error" action={<button type="button" className="btn sm" onClick={reload}>再試行</button>}>
          {error.message}
        </Notice>
      ) : null}
      {loading && !meta ? (
        <Skeleton variant="text" rows={3} w="40%" />
      ) : Page ? (
        <Suspense fallback={<Skeleton variant="row" rows={6} />}>
          <Page params={route?.params ?? {}} />
        </Suspense>
      ) : (
        <EmptyState title="ページが見つかりません" body={<a href="/">ボードへ戻る</a>} />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
