// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
import { useId, type ReactNode } from 'react';

/**
 * 「?」アイコン。ホバー / フォーカスで説明を出す（説明文は既定では表示しない）。
 * 説明は DOM に常にあるので、支援技術には aria-describedby で結びつける。
 */
export function Help({ text, label = '説明', wide = false }: { text: ReactNode; label?: string; wide?: boolean }) {
  const id = useId();
  return (
    <span className="help">
      <button type="button" className="help-btn" aria-label={label} aria-describedby={id}>
        ?
      </button>
      <span className={`help-pop ${wide ? 'wide' : ''}`} role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
