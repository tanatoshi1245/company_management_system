import type { AuditEntry } from '../../../../shared/schema/targets';
import { isoToJstDisplay } from '../../../../shared/calendar/periods';
import { TARGET_METRIC_LABEL, TARGET_METRICS, STAGE_TARGET_LABEL, STAGE_TARGET_KEYS, type TargetValues } from '../../../../shared/schema/targets';

const ACTION: Record<AuditEntry['action'], string> = { create: '登録', update: '更新', delete: '削除' };
const ENTITY: Record<string, string> = { company_targets: '目標', company_settings: '企業設定', plan_target_defaults: 'プラン既定値', app_meta: 'キャッシュ' };

function summarize(e: AuditEntry): string {
  if (e.entity !== 'company_targets') return e.entity === 'company_settings' ? '担当・枠・メモの変更' : '';
  const b = (e.before as { values?: TargetValues } | null)?.values;
  const a = (e.after as { values?: TargetValues; copiedFrom?: string; fromPlan?: string } | null)?.values;
  const extra = (e.after as { copiedFrom?: string; fromPlan?: string } | null) ?? {};
  const parts: string[] = [];
  for (const k of TARGET_METRICS) {
    const bv = b?.[k] ?? null;
    const av = a?.[k] ?? null;
    if (bv !== av) parts.push(`${TARGET_METRIC_LABEL[k]} ${bv ?? '–'} → ${av ?? '–'}`);
  }
  for (const k of STAGE_TARGET_KEYS) {
    const bv = b?.stages?.[k] ?? null;
    const av = a?.stages?.[k] ?? null;
    if (bv !== av) parts.push(`${STAGE_TARGET_LABEL[k]} ${bv ?? '–'} → ${av ?? '–'}`);
  }
  if (extra.copiedFrom) parts.push(`（${extra.copiedFrom} からコピー）`);
  if (extra.fromPlan) parts.push(`（プラン ${extra.fromPlan} の既定値）`);
  return parts.join('、');
}

export function ChangeHistory({ rows }: { rows: AuditEntry[] }) {
  if (!rows.length) return <div className="empty">まだ変更はありません</div>;
  return (
    <div className="table-wrap">
      <table className="data compact" aria-label="変更履歴">
        <thead>
          <tr>
            <th>日時</th>
            <th>誰が</th>
            <th>何を</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="num">{isoToJstDisplay(e.at) ?? e.at}</td>
              <td>{e.actor}</td>
              <td>
                {ENTITY[e.entity] ?? e.entity} {e.entity === 'company_targets' ? e.entityId.split('/')[1] : ''} を{ACTION[e.action]}
              </td>
              <td className="small">{summarize(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
