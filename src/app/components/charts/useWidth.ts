// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
import { useEffect, useRef, useState } from 'react';

/** 要素の幅を追従する（SVG をコンテナ幅で描くため） */
export function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(240, Math.floor(el.getBoundingClientRect().width)) || fallback);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}
