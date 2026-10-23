import type { ButtonHTMLAttributes } from 'react';

export function Button({ variant = 'default', size, loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm'; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading} className={`btn ${variant === 'default' ? '' : variant} ${size ?? ''} ${className ?? ''}`} aria-busy={loading || undefined}>
      {children}
    </button>
  );
}
