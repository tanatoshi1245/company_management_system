import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'navy' | 'good' | 'warn' | 'bad';
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}
