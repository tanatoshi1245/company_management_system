import { useState } from 'react';
import type { AttributeBreakdown } from '../companyModel';
import { ATTRIBUTE_LABEL, ATTRIBUTE_TYPES, type AttributeType } from '../../../../shared/labels';
import { PieChart } from '../../../components/charts/PieChart';
import { Segmented } from '../../../components/ui/Segmented';
import { Help } from '../../../components/ui/Help';
import { Skeleton } from '../../../components/ui/Skeleton';

/** sent = スカウトを送った会員 / replied = 興味あり返信した会員 / viewed = 求人を閲覧した会員 / applied = 応募した会員 */
export type PieMode = 'sent' | 'replied' | 'viewed' | 'applied';
export const PIE_MODE_LABEL: Record<PieMode, string> = { sent: '送信', replied: '興味あり', viewed: '閲覧', applied: '応募' };
const MODE_UNIT: Record<PieMode, string> = { sent: '件', replied: '件', viewed: '件', applied: '件' };

/**
 * 会員属性の内訳（同一サイズの円グラフ。属性タブで切替）。
 * modes が 2 つ以上なら 送信 / 興味あり、閲覧 / 応募 のように対象を切り替えられる。内訳は選択期間・選択アカウントで集約済み（属性 API）
 */
export function AttributePiePanel({ title, help, breakdown, range, modes, state = 'ready', initial, onChange, testId }: { title: string; help: string; breakdown: Record<PieMode, Record<string, AttributeBreakdown[]>>; range: string; modes: PieMode[]; state?: 'loading' | 'error' | 'ready'; initial?: string; onChange?: (t: AttributeType) => void; testId: string }) {
  const [type, setTypeState] = useState<AttributeType>((ATTRIBUTE_TYPES as readonly string[]).includes(initial ?? '') ? (initial as AttributeType) : 'japanese_level');
  const [mode, setMode] = useState<PieMode>(modes[0]);
  const setType = (t: AttributeType) => {
    setTypeState(t);
    onChange?.(t);
  };
  const rows = breakdown[mode]?.[type] ?? [];
  return (
    <section className="card" aria-label={title} data-testid={testId}>
      <div className="card-head">
        <h2>
          {title} <Help text={help} />
        </h2>
        <span className="lead">{range} の分</span>
        {modes.length > 1 ? <Segmented options={modes.map((m) => ({ key: m, label: PIE_MODE_LABEL[m] }))} value={mode} onChange={setMode} ariaLabel={`${title}の対象`} /> : null}
      </div>
      <div className="tabs" role="tablist" aria-label={`${title}の属性`}>
        {ATTRIBUTE_TYPES.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
            {ATTRIBUTE_LABEL[t]}
          </button>
        ))}
      </div>
      {state === 'loading' && !rows.length ? (
        <Skeleton variant="tile" />
      ) : state === 'error' && !rows.length ? (
        <div className="empty">属性の内訳を取得できませんでした</div>
      ) : rows.length ? (
        <PieChart rows={rows.map((r) => ({ label: r.value, value: r.count }))} ariaLabel={`${ATTRIBUTE_LABEL[type]} の内訳（${PIE_MODE_LABEL[mode]}）`} unit={MODE_UNIT[mode]} />
      ) : (
        <div className="empty">この期間のデータがありません</div>
      )}
    </section>
  );
}
