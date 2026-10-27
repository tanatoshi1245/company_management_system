import { useState } from 'react';
import type { AttributeBreakdown } from '../companyModel';
import { ATTRIBUTE_LABEL, ATTRIBUTE_TYPES, type AttributeType } from '../../../../shared/labels';
import { PieChart } from '../../../components/charts/PieChart';
import { Segmented } from '../../../components/ui/Segmented';
import { Help } from '../../../components/ui/Help';
import { fmtMonthShort } from '../../../../shared/calendar/periods';

export type PieMode = 'sent' | 'replied' | 'viewed';
const MODE_LABEL: Record<PieMode, string> = { sent: '送信', replied: '返信', viewed: '閲覧' };
const MODE_UNIT: Record<PieMode, string> = { sent: '件', replied: '件', viewed: '件' };

/**
 * 会員属性の内訳（同一サイズの円グラフ。属性タブで切替）。
 * modes が 2 つ以上なら 送信 / 返信 のように対象を切り替えられる
 */
export function AttributePiePanel({ title, help, breakdown, months, modes, initial, onChange, testId }: { title: string; help: string; breakdown: Record<PieMode, Record<string, AttributeBreakdown[]>>; months: string[]; modes: PieMode[]; initial?: string; onChange?: (t: AttributeType) => void; testId: string }) {
  const [type, setTypeState] = useState<AttributeType>((ATTRIBUTE_TYPES as readonly string[]).includes(initial ?? '') ? (initial as AttributeType) : 'japanese_level');
  const [mode, setMode] = useState<PieMode>(modes[0]);
  const setType = (t: AttributeType) => {
    setTypeState(t);
    onChange?.(t);
  };
  const rows = breakdown[mode]?.[type] ?? [];
  const range = months.length ? `${fmtMonthShort(months[0])}〜${fmtMonthShort(months[months.length - 1])}` : '';
  return (
    <section className="card" aria-label={title} data-testid={testId}>
      <div className="card-head">
        <h2>
          {title} <Help text={help} />
        </h2>
        <span className="lead">{range} の分</span>
        {modes.length > 1 ? <Segmented options={modes.map((m) => ({ key: m, label: MODE_LABEL[m] }))} value={mode} onChange={setMode} ariaLabel={`${title}の対象`} /> : null}
      </div>
      <div className="tabs" role="tablist" aria-label={`${title}の属性`}>
        {ATTRIBUTE_TYPES.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
            {ATTRIBUTE_LABEL[t]}
          </button>
        ))}
      </div>
      {rows.length ? <PieChart rows={rows.map((r) => ({ label: r.value, value: r.count }))} ariaLabel={`${ATTRIBUTE_LABEL[type]} の内訳（${MODE_LABEL[mode]}）`} unit={MODE_UNIT[mode]} /> : <div className="empty">この期間のデータがありません</div>}
    </section>
  );
}
