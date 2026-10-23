// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
import type { ReactNode } from 'react';

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** チャート内の絶対配置ツールチップ（右端で反転） */
export function ChartTooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width * 0.65;
  const style = flip ? { right: width - tip.x + 10, top: tip.y - 8 } : { left: tip.x + 10, top: tip.y - 8 };
  return (
    <div className="chart-tooltip" role="status" style={style}>
      {tip.content}
    </div>
  );
}
