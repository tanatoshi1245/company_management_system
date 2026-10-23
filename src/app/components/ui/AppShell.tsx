import type { ReactNode } from 'react';

export function AppShell({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="rail">{rail}</aside>
      <main className="main">{children}</main>
    </div>
  );
}
