export type IconName = 'home' | 'target' | 'settings' | 'help' | 'search' | 'close' | 'arrowRight' | 'arrowLeft' | 'external' | 'copy' | 'history' | 'warning' | 'check' | 'chevronDown' | 'refresh' | 'logout' | 'edit' | 'filter';

const PATHS: Record<IconName, string> = {
  home: 'M3 8.5 8 4l5 4.5V13H9.5V9.5h-3V13H3z',
  target: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zm0 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1v2M8 13v2M1 8h2M13 8h2',
  settings: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
  help: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm-1.6 4.5A1.7 1.7 0 0 1 8 5c1 0 1.7.6 1.7 1.4 0 1.2-1.7 1.3-1.7 2.6M8 11.3v.2',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3 14 14',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  arrowRight: 'M3 8h10M9 4l4 4-4 4',
  arrowLeft: 'M13 8H3M7 4 3 8l4 4',
  external: 'M9 2.5h4.5V7M13.5 2.5 7 9M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3M8 5v3.3l2.2 1.3',
  warning: 'M8 2.2 14.2 13H1.8zM8 6.5v3M8 11.5v.2',
  check: 'M3 8.5l3.2 3L13 4.5',
  chevronDown: 'M4 6.5 8 10l4-3.5',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  logout: 'M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10 11.5 13.5 8 10 4.5M13.5 8H6',
  edit: 'M10.5 2.5 13.5 5.5 6 13H3v-3zM9 4l3 3',
  filter: 'M2 3h12l-4.5 5.5V13L7 11.5V8.5z',
};

/** 1.5px ストロークの線画アイコン（currentColor）。絵文字・アイコンフォントは使わない */
export function Icon({ name, size = 16, className, title }: { name: IconName; size?: 14 | 16 | 20; className?: string; title?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
