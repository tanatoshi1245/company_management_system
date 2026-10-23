import { useState } from 'react';
import { apiSend } from '../../../lib/api';
import { clearResourceCache, invalidate } from '../../../lib/useResource';
import { Button } from '../../../components/ui/Button';

/** マートを手動で再実行したあとに Worker のキャッシュを捨てる */
export function CacheBumpButton({ canEdit }: { canEdit: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiSend<{ cacheEpoch: string }>('POST', '/api/admin/cache/bump', {});
      clearResourceCache();
      invalidate('/api/');
      setMsg(`キャッシュを捨てました（版 ${r.cacheEpoch}）。次の表示で取り直します`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-actions">
      <Button size="sm" onClick={run} loading={busy} disabled={!canEdit} title="マートを手動で再実行したあとに使う">
        Worker のキャッシュを捨てる
      </Button>
      {msg ? (
        <span className="small muted" role="status">
          {msg}
        </span>
      ) : null}
    </div>
  );
}
