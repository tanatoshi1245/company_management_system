import { EmptyState } from '../../../components/ui/EmptyState';

export function EmptyBoard({ onClear, hasFilters }: { onClear: () => void; hasFilters: boolean }) {
  return (
    <div className="card">
      <EmptyState
        title="該当する企業がありません"
        body={hasFilters ? '絞り込みを変えるか、クリアしてください' : 'この月に契約中の企業が見つかりません'}
        action={
          hasFilters ? (
            <button type="button" className="btn" onClick={onClear}>
              絞り込みをクリア
            </button>
          ) : null
        }
      />
    </div>
  );
}
