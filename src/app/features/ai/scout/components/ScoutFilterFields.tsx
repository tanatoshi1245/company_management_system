import { useId } from 'react';
import { SCOUT_FILTER_KEYS, SCOUT_FILTER_LABEL, SCOUT_FILTER_MAX, type ScoutFilterKey, type ScoutFilters, type ScoutOptionsResponse } from '../../../../../shared/ai/scout';
import { SCOUT_TEXT } from '../../../../../shared/ai/options';
import { Chip } from '../../../../components/ui/Chip';
import { AiField } from '../../common/Field';
import { TagCombobox } from '../../common/TagCombobox';
import { toggleFilter } from '../scoutModel';

/** 選択肢が少ない条件は、押して選ぶチップの列にする（それ以外は、絞り込んで選ぶプルダウン） */
const CHIP_KEYS: readonly ScoutFilterKey[] = ['ageGroups', 'nationalities'];
const CHIP_MAX_OPTIONS = 12;

/**
 * 送る相手の条件（年齢層・国籍・日本語力・英語力・現住所・経験職種）。値は GET /api/ai/scout/options（マートにある値）だけ。
 * 指定すると、その条件の人に送ったスカウトだけで返信率を数え直して、分析する文面を選ぶ。各 SCOUT_FILTER_MAX 個まで。
 */
export function ScoutFilterFields({ value, onChange, options, loading, error, disabled }: { value: ScoutFilters; onChange: (next: ScoutFilters) => void; options: ScoutOptionsResponse | null; loading: boolean; error: string | null; disabled?: boolean }) {
  const uid = useId();
  if (error) return <p className="ai-caveat">条件の選択肢を読み込めませんでした（{error}）。条件なしで実行できます</p>;
  if (!options) return <p className="muted small">{loading ? '条件の選択肢を読み込んでいます…' : ''}</p>;
  if (options.dataDate === null) return <p className="ai-caveat">{SCOUT_TEXT.noMart}</p>;
  return (
    <div className="ai-fields">
      {SCOUT_FILTER_KEYS.map((key) => {
        const label = SCOUT_FILTER_LABEL[key];
        // 選んだ値が選択肢から消えていても（マートの更新）、外せるように残す
        const opts = Array.from(new Set([...options[key], ...value[key]]));
        const picked = value[key];
        const full = picked.length >= SCOUT_FILTER_MAX;
        const asChips = CHIP_KEYS.includes(key) && opts.length <= CHIP_MAX_OPTIONS;
        return (
          <AiField key={key} label={label} htmlFor={asChips ? undefined : `${uid}-${key}`} wide={asChips} hint={picked.length ? `${picked.length} 個を指定（${SCOUT_FILTER_MAX} 個まで）` : '指定なし'}>
            {asChips ? (
              <div className="chip-group" role="group" aria-label={label}>
                {opts.length ? opts.map((o) => <Chip key={o} label={o} on={picked.includes(o)} disabled={disabled || (full && !picked.includes(o))} onClick={() => onChange(toggleFilter(value, key, o))} />) : <span className="muted small">選択肢がありません</span>}
              </div>
            ) : (
              <TagCombobox id={`${uid}-${key}`} values={picked} onChange={(v) => onChange({ ...value, [key]: v })} options={opts} max={SCOUT_FILTER_MAX} placeholder="入力して選ぶ" disabled={disabled} ariaLabel={label} allowFree={false} />
            )}
          </AiField>
        );
      })}
    </div>
  );
}
