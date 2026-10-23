import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { apiSend } from '../../../lib/api';
import { invalidate } from '../../../lib/useResource';
import { addMonths, fmtMonthJa } from '../../../../shared/calendar/periods';
import type { PlanDefaultsResponse } from '../../../../shared/schema/targets';

/** プラン既定値で、目標が無い (企業, 月) を埋める */
export function BulkDefaultsDialog({ month, planDefaults, mineIds, onClose, onDone }: { month: string; planDefaults: PlanDefaultsResponse | null; mineIds: string[]; onClose: () => void; onDone: (created: number) => void }) {
  const candidates = Array.from({ length: 6 }, (_, i) => addMonths(month, i));
  const [months, setMonths] = useState<Set<string>>(new Set([month, addMonths(month, 1)]));
  const [onlyMine, setOnlyMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plans = Object.keys(planDefaults?.plans ?? {});
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiSend<{ created: number }>('POST', '/api/targets/bulk-defaults', { months: Array.from(months), ...(onlyMine ? { companyIds: mineIds } : {}) });
      invalidate('/api/targets');
      invalidate('/api/board');
      invalidate('/api/companies/');
      onDone(r.created);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="プラン既定値で未設定を埋める" onClose={onClose}>
      <p className="small">既に目標がある月は変更しません。プラン既定値が未登録のプラン（{plans.length ? `登録済み: ${plans.join('、')}` : '登録なし'}）の企業は対象外です。</p>
      <fieldset className="fieldset">
        <legend>対象の月</legend>
        {candidates.map((m) => (
          <label key={m} className="check">
            <input
              type="checkbox"
              checked={months.has(m)}
              onChange={(e) => {
                const n = new Set(months);
                if (e.target.checked) n.add(m);
                else n.delete(m);
                setMonths(n);
              }}
            />
            {fmtMonthJa(m)}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} disabled={!mineIds.length} /> 担当=自分 の企業だけ（{mineIds.length} 社）
      </label>
      {err ? (
        <p className="small err" role="alert">
          {err}
        </p>
      ) : null}
      <div className="form-actions">
        <Button variant="primary" onClick={run} loading={busy} disabled={!months.size || !plans.length}>
          実行
        </Button>
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </Modal>
  );
}
