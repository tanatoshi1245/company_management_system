import type { ReactNode } from 'react';
import { Link } from '../../router';

export function PageHeader({ title, context, actions, breadcrumb }: { title: ReactNode; context?: ReactNode; actions?: ReactNode; breadcrumb?: { label: string; to: string }[] }) {
  return (
    <header className="page-head">
      <div>
        {breadcrumb?.length ? (
          <div className="breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={b.to}>
                {i > 0 ? ' / ' : ''}
                <Link to={b.to}>{b.label}</Link>
              </span>
            ))}
            {' / '}
          </div>
        ) : null}
        <h1>{title}</h1>
        {context ? <div className="context">{context}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}
