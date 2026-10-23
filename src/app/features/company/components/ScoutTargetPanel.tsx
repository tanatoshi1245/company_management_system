import { useState } from 'react';
import type { CompanyModel } from '../companyModel';
import { ATTRIBUTE_LABEL, ATTRIBUTE_TYPES, type AttributeType } from '../../../../shared/labels';
import { AttributeBars } from '../../../components/charts/AttributeBars';
import { Help } from '../../../components/ui/Help';
import { fmtMonthShort } from '../../../../shared/calendar/periods';

export function ScoutTargetPanel({ m, initial, onChange }: { m: CompanyModel; initial?: string; onChange?: (t: AttributeType) => void }) {
  const [type, setTypeState] = useState<AttributeType>((ATTRIBUTE_TYPES as readonly string[]).includes(initial ?? '') ? (initial as AttributeType) : 'japanese_level');
  const setType = (t: AttributeType) => {
    setTypeState(t);
    onChange?.(t);
  };
  const rows = m.attributes[type] ?? [];
  const range = m.attrMonths.length ? `${fmtMonthShort(m.attrMonths[0])}〜${fmtMonthShort(m.attrMonths[m.attrMonths.length - 1])}` : '';
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          誰にスカウトを送っているか <Help text="直近 3 か月（選択月まで）に送ったスカウトの会員属性。属性は現在のプロフィール。右の数字は興味あり返信率（5 件未満は出さない）" />
        </h2>
        <span className="lead">{range} の送信分</span>
      </div>
      <div className="tabs" role="tablist" aria-label="属性">
        {ATTRIBUTE_TYPES.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
            {ATTRIBUTE_LABEL[t]}
          </button>
        ))}
      </div>
      {rows.length ? <AttributeBars rows={rows} /> : <div className="empty">この期間のスカウトがありません</div>}
    </section>
  );
}
