import { useEffect, useMemo, useState } from 'react';
import { invalidate, useResource } from '../../../lib/useResource';
import { apiSend } from '../../../lib/api';
import { BoardResponseSchema } from '../../../../shared/schema/board';
import { PLAN_DEFAULT_LABEL, PLAN_DEFAULT_METRICS, PlanDefaultsResponseSchema, type PlanDefaultValues } from '../../../../shared/schema/targets';
import { Button } from '../../../components/ui/Button';
import { Help } from '../../../components/ui/Help';

type Draft = Record<string, Record<string, string>>;

/** プラン別の既定目標（D1 plan_target_defaults）。行 = プラン（ボードに出ているプラン ∪ 登録済み） */
export function PlanDefaultsEditor({ month, canEdit }: { month: string | null; canEdit: boolean }) {
  const res = useResource('/api/settings/plan-defaults', PlanDefaultsResponseSchema, { ttlMs: 0 });
  const board = useResource(month ? `/api/board?month=${month}` : null, BoardResponseSchema, { ttlMs: 5 * 60_000 });
  const plans = useMemo(() => {
    const s = new Set<string>(Object.keys(res.data?.plans ?? {}));
    for (const c of board.data?.companies ?? []) if (c.plan) s.add(c.plan);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [res.data, board.data]);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const d: Draft = {};
    for (const p of plans) {
      d[p] = {};
      for (const m of PLAN_DEFAULT_METRICS) {
        const v = res.data?.plans[p]?.[m];
        d[p][m] = v === null || v === undefined ? '' : String(v);
      }
    }
    setDraft(d);
  }, [plans, res.data]);
  const dirty = (p: string) => PLAN_DEFAULT_METRICS.some((m) => (draft[p]?.[m] ?? '') !== (res.data?.plans[p]?.[m] === undefined ? '' : String(res.data?.plans[p]?.[m])));
  const save = async (p: string) => {
    const values: PlanDefaultValues = {};
    for (const m of PLAN_DEFAULT_METRICS) {
      const s = (draft[p]?.[m] ?? '').trim();
      if (s === '') continue;
      if (!/^\d+$/.test(s)) {
        setMsg(`${p}: ${PLAN_DEFAULT_LABEL[m]} は 0 以上の整数で入力してください`);
        return;
      }
      values[m] = Number(s);
    }
    setBusy(p);
    setMsg(null);
    try {
      await apiSend('PUT', '/api/settings/plan-defaults', { plan: p, values });
      invalidate('/api/settings/plan-defaults');
      setMsg(`${p} の既定値を保存しました`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const count = (p: string) => (board.data?.companies ?? []).filter((x) => x.plan === p).length;
  return (
    <section className="card" id="plan-defaults">
      <div className="card-head">
        <h2>
          プラン別の既定目標 <Help text="「プラン既定値で未設定を埋める」と、目標フォームの「プラン既定値を適用」に使う。空欄 = その指標は既定値なし。プラン名は Salesforce 契約のプラン名（cms_company_master.plan_name）" />
        </h2>
      </div>
      {plans.length === 0 ? (
        <div className="empty">プランがありません</div>
      ) : (
        <div className="table-wrap">
          <table className="data compact plan-defaults" aria-label="プラン別の既定目標">
            <thead>
              <tr>
                <th>プラン</th>
                <th className="num">企業数</th>
                {PLAN_DEFAULT_METRICS.map((m) => (
                  <th key={m} className="num">
                    {PLAN_DEFAULT_LABEL[m]}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p}>
                  <th scope="row">{p}</th>
                  <td className="num muted">{count(p)}</td>
                  {PLAN_DEFAULT_METRICS.map((m) => (
                    <td key={m} className="num">
                      <input className={`ctl num ${dirty(p) ? 'dirty' : ''}`} inputMode="numeric" aria-label={`${p} ${PLAN_DEFAULT_LABEL[m]}`} disabled={!canEdit} value={draft[p]?.[m] ?? ''} onChange={(e) => setDraft({ ...draft, [p]: { ...draft[p], [m]: e.target.value } })} />
                    </td>
                  ))}
                  <td>
                    <Button size="sm" variant="primary" disabled={!canEdit || !dirty(p)} loading={busy === p} onClick={() => save(p)} aria-label={`${p} を保存`}>
                      保存
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg ? (
        <p className="small muted" role="status">
          {msg}
        </p>
      ) : null}
    </section>
  );
}
