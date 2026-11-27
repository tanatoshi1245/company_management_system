import { SCOUT_BASIS_LABEL, type ScoutJobSummary, type ScoutMemberSummary, type ScoutTarget } from '../../../../../shared/ai/scout';
import { SCOUT_TEXT } from '../../../../../shared/ai/options';
import { Badge } from '../../../../components/ui/Badge';
import { filterChips, resumeLine } from '../scoutModel';

/** 求人・候補者の要約のカード（入力で確かめるとき・結果で「何をもとに作ったか」を出すとき、の両方で使う） */

const dash = (v: string | null): string => (v && v.trim() ? v : '—');

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** 求人の内容（タイトル・職種・勤務地・年収・語学力・掲載中か・仕事内容と応募条件の先頭） */
export function ScoutJobCard({ job }: { job: ScoutJobSummary }) {
  return (
    <section className="ai-target-card" aria-label="求人の内容" data-job={job.jobId}>
      <header>
        <b className="ttl">{job.title}</b>
        <span className="muted small num">求人 ID {job.jobId}</span>
        <Badge tone={job.published ? 'good' : 'warn'}>{job.published ? '掲載中' : '掲載終了'}</Badge>
      </header>
      {job.published ? null : <p className="ai-caveat">{SCOUT_TEXT.jobUnpublished}</p>}
      <dl className="ai-target-kv">
        <Row label="職種" value={dash(job.occupation)} />
        <Row label="勤務地" value={dash(job.location)} />
        <Row label="年収" value={dash(job.salary)} />
        <Row label="日本語" value={dash(job.japaneseLevel)} />
        <Row label="英語" value={dash(job.englishLevel)} />
      </dl>
      {job.descriptionHead ? (
        <div className="ai-target-head">
          <span className="lbl">仕事内容（先頭）</span>
          <p>{job.descriptionHead}</p>
        </div>
      ) : null}
      {job.requirementsHead ? (
        <div className="ai-target-head">
          <span className="lbl">応募条件（先頭）</span>
          <p>{job.requirementsHead}</p>
        </div>
      ) : null}
    </section>
  );
}

const list = (v: string[]): string => (v.length ? v.join('、') : '—');

/**
 * 候補者の情報（BigQuery にある属性と、職務経歴・自己PR の登録の有無。氏名・連絡先・本文は無い）。分析対象の絞り込みに使う条件をチップで見せる。
 * 職務経歴・自己PR は、件数・文字数・直近の役職名だけ（本文は応答に無い。文面を作るときに Worker が AI へ渡す）
 */
export function ScoutMemberCard({ member, showFilters = true }: { member: ScoutMemberSummary; showFilters?: boolean }) {
  const chips = filterChips(member.filters);
  return (
    <section className="ai-target-card" aria-label="候補者の情報" data-member={member.memberId}>
      <header>
        <b className="ttl">{dash(member.occupation)}</b>
        <span className="muted small num">会員 ID {member.memberId}</span>
      </header>
      <p className="muted small">{SCOUT_TEXT.memberPrivacy}</p>
      <dl className="ai-target-kv">
        <Row label="年齢層" value={dash(member.ageGroup)} />
        <Row label="国籍" value={dash(member.nationality)} />
        <Row label="現住所" value={dash(member.residence)} />
        <Row label="日本語" value={dash(member.japaneseLevel)} />
        <Row label="英語" value={dash(member.englishLevel)} />
        <Row label="最終の業種" value={dash(member.lastIndustry)} />
        <Row label="役職レベル" value={dash(member.careerLevel)} />
        <Row label="年収" value={dash(member.incomeRange)} />
        <Row label="希望年収" value={dash(member.desiredIncomeRange)} />
      </dl>
      <dl className="ai-target-kv wide">
        <Row label="経験職種" value={list(member.experiencedOccupations)} />
        <Row label="希望職種" value={list(member.desiredOccupations)} />
      </dl>
      <div className="ai-target-head" role="group" aria-label={SCOUT_TEXT.resumeLabel} data-resume={member.resume ? 'yes' : 'no'}>
        <span className="lbl">{SCOUT_TEXT.resumeLabel}</span>
        {member.resume ? (
          <>
            <p>{resumeLine(member.resume)}</p>
            <p>{SCOUT_TEXT.resumeUse}</p>
            <p className="muted small">{SCOUT_TEXT.resumeCaution}</p>
          </>
        ) : (
          <p>{SCOUT_TEXT.resumeNone}</p>
        )}
      </div>
      {showFilters ? (
        <div className="ai-target-filters">
          <p className="small">{chips.length ? SCOUT_TEXT.memberFilters : SCOUT_TEXT.memberNoFilters}</p>
          {chips.length ? (
            <ul className="ai-tag-list" aria-label="分析対象の絞り込みに使う条件">
              {chips.map((c) => (
                <li key={`${c.key}-${c.value}`} className="ai-tag static">
                  <span>
                    {c.label}: {c.value}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 結果の見出しの下: 何をもとに作ったか（作り方・求人の要約・候補者の要約。候補者は畳んでおく） */
export function ScoutTargetView({ target }: { target: ScoutTarget }) {
  const { job, member } = target;
  const languages = member ? [member.japaneseLevel ? `日本語 ${member.japaneseLevel}` : null, member.englishLevel ? `英語 ${member.englishLevel}` : null].filter(Boolean).join('・') : '';
  return (
    <div className="ai-target" role="group" aria-label={SCOUT_TEXT.targetLabel}>
      <p className="ai-target-line">
        <Badge tone="navy">{SCOUT_BASIS_LABEL[target.basis]}</Badge>
        {job ? (
          <span>
            求人: <b>{job.title}</b>
            <span className="muted num">（ID {job.jobId}）</span>
          </span>
        ) : null}
      </p>
      {job ? (
        <details>
          <summary>求人の内容</summary>
          <ScoutJobCard job={job} />
        </details>
      ) : null}
      {member ? (
        <details>
          <summary>
            候補者: 会員 ID <span className="num">{member.memberId}</span>
            {member.occupation ? `・${member.occupation}` : ''}
            {languages ? `・${languages}` : ''}
            {`・${SCOUT_TEXT.resumeLabel} ${member.resume ? 'あり' : 'なし（属性だけで作成）'}`}
          </summary>
          <ScoutMemberCard member={member} />
        </details>
      ) : null}
    </div>
  );
}
