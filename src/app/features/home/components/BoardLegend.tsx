import type { BoardMeta } from '../../../../shared/schema/board';
import { NO_LOGIN_DAYS } from '../../../../shared/metrics/board';

export function BoardLegend({ meta }: { meta: BoardMeta }) {
  return (
    <div className="board-foot">
      <div className="legend" aria-label="色の意味">
        <span>
          <span className="sw zero" />
          掲載・閲覧・応募・スカウト送信が 0 件、または {NO_LOGIN_DAYS} 日以上ログインなし（記録なしを含む）
        </span>
      </div>
      <div>
        契約中の企業のみ
        {meta.isCurrentMonth ? `・営業日 ${meta.bizDays.elapsed}/${meta.bizDays.total} 日経過（データは ${meta.dataDate} まで）` : '・月の全期間'}
        ・返信は返信月基準（その月に興味あり返信があった数。送信月は問わない）・ログインは 2026-05-15 以降の CT 画面
      </div>
    </div>
  );
}
