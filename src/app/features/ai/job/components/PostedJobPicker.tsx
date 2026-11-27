import { useMemo, useState } from 'react';
import type { AiCompanyJob } from '../../../../../shared/ai/common';
import { ComboboxCore } from '../../common/Combobox';

export const postedJobHint = (j: AiCompanyJob): string => [j.occupation, j.location, j.salaryBand].filter((v) => v && v !== '未設定').join('・');

/**
 * 掲載中の求人から選ぶ（企業の直近の掲載求人 = defaults の jobs。閲覧の多い順）。一覧にある求人だけ選べる。
 * 選んだ後は求人タイトルを表示し、× で外せる。
 */
export function PostedJobPicker({ jobs, value, onChange, disabled, id, invalid, noCompany }: { jobs: AiCompanyJob[]; value: string | null; onChange: (job: AiCompanyJob | null) => void; disabled?: boolean; id?: string; invalid?: boolean; noCompany?: boolean }) {
  const [text, setText] = useState('');
  const items = useMemo(() => jobs.map((j) => ({ key: j.jobKey, label: j.title, hint: postedJobHint(j) || undefined })), [jobs]);
  const selected = value ? jobs.find((j) => j.jobKey === value) ?? null : null;
  if (value) {
    return (
      <div className={`ai-company-picked${disabled ? ' disabled' : ''}`} id={id}>
        <span className="nm">{selected ? selected.title : `求人 ${value}`}</span>
        {selected && postedJobHint(selected) ? <span className="hint">{postedJobHint(selected)}</span> : null}
        <button
          type="button"
          aria-label="求人の選択を外す"
          disabled={disabled}
          onClick={() => {
            setText('');
            onChange(null);
          }}
        >
          ×
        </button>
      </div>
    );
  }
  return (
    <ComboboxCore
      id={id}
      text={text}
      onText={setText}
      items={items}
      onPick={(it) => {
        setText('');
        onChange(jobs.find((j) => j.jobKey === it.key) ?? null);
      }}
      onBlur={() => setText('')}
      placeholder={noCompany ? '先に企業を選んでください' : jobs.length ? '求人タイトルを入力して選ぶ' : '直近の掲載求人がありません'}
      disabled={disabled || noCompany || jobs.length === 0}
      allowFree={false}
      ariaLabel="掲載中の求人から選ぶ"
      invalid={invalid}
    />
  );
}
