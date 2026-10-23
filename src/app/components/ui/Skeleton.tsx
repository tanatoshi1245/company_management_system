export function Skeleton({ variant = 'text', rows = 1, w, h }: { variant?: 'text' | 'tile' | 'row'; rows?: number; w?: number | string; h?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skeleton ${variant}`} style={{ width: w, height: h }} />
      ))}
    </div>
  );
}
