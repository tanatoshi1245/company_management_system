import { useState } from 'react';
import type { ScoutModel, ScoutModelStats, ScoutModelVersion, ScoutTuneResponse } from '../../../../../shared/ai/scout';
import { SCOUT_TUNE_MIN_JUDGED } from '../../../../../shared/ai/scout';
import { SCOUT_TEXT } from '../../../../../shared/ai/options';
import { isoToJstDisplay } from '../../../../../shared/calendar/periods';
import { Badge, type Tone } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Notice } from '../../../../components/ui/Notice';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { rollbackScoutModel, runScoutTune, useScoutModels } from '../../common/aiApi';
import { aiErrorMessage } from '../../common/useAiWorkspace';
import { fmtInt, fmtPct } from '../scoutModel';

const ORIGIN_LABEL: Record<ScoutModelVersion['origin'], string> = { initial: '初版', tuned: 'チューニング', rollback: '戻した', manual: '手動' };
const ACTION_LABEL: Record<ScoutTuneResponse['results'][number]['action'], string> = { kept: '据え置き', tuned: '直した', rolledBack: '戻した', failed: '失敗' };
const ACTION_TONE: Record<ScoutTuneResponse['results'][number]['action'], Tone> = { kept: 'neutral', tuned: 'good', rolledBack: 'warn', failed: 'bad' };
const day = (iso: string): string => isoToJstDisplay(iso) ?? iso;
const score = (v: number | null): string => (v === null ? '—' : v.toFixed(1));

function StatTiles({ stats }: { stats: ScoutModelStats }) {
  return (
    <dl className="ai-basis six" aria-label="いまの版の成績">
      <div>
        <dt>作った案</dt>
        <dd className="num">{fmtInt(stats.drafts)}</dd>
      </div>
      <div>
        <dt>判断された数</dt>
        <dd className="num">{fmtInt(stats.judged)}</dd>
      </div>
      <div>
        <dt>選ばれた率</dt>
        <dd className="num strong">{fmtPct(stats.chosenRatePct)}</dd>
        <dd className="sub num">{fmtInt(stats.chosen)} / {fmtInt(stats.judged)}</dd>
      </div>
      <div>
        <dt>使われた数</dt>
        <dd className="num">{fmtInt(stats.used)}</dd>
      </div>
      <div>
        <dt>返信率</dt>
        <dd className="num">{fmtPct(stats.replyRatePct)}</dd>
        <dd className="sub num">
          返信 {fmtInt(stats.replies)} / 送信 {fmtInt(stats.sends)}・採用 {fmtInt(stats.hires)}
        </dd>
      </div>
      <div>
        <dt>総合点</dt>
        <dd className="num strong">{score(stats.score)}</dd>
        <dd className="sub">0〜100</dd>
      </div>
    </dl>
  );
}

function ModelCard({ model, admin, busy, onRollback }: { model: ScoutModel; admin: boolean; busy: boolean; onRollback: (version: number) => void }) {
  const [open, setOpen] = useState(false);
  /** プレイブックを開いている版 */
  const [playbookOf, setPlaybookOf] = useState<number | null>(null);
  /** 「この版に戻す」を 1 度押した版（もう一度押すと戻す） */
  const [confirming, setConfirming] = useState<number | null>(null);
  const versions = [...model.versions].sort((a, b) => b.version - a.version);
  const active = versions.find((v) => v.active) ?? versions.find((v) => v.version === model.activeVersion) ?? null;
  const shownPlaybook = versions.find((v) => v.version === playbookOf) ?? null;
  return (
    <section className="card ai-section ai-model" aria-label={model.label} data-model={model.id}>
      <div className="card-head">
        <h2>{model.label}</h2>
        <span className="ai-edited">
          <Badge tone="navy">第 {model.activeVersion} 版</Badge>
          {model.engine ? <span className="muted small num">{model.engine}</span> : null}
        </span>
      </div>
      <p className="lead">{model.description}</p>
      {active ? <StatTiles stats={active.stats} /> : <p className="muted small">いまの版の成績は、まだありません</p>}
      {active && active.stats.judged < SCOUT_TUNE_MIN_JUDGED ? <p className="muted small">判断された数が {SCOUT_TUNE_MIN_JUDGED} 件になるまでは、チューニングせず据え置きます</p> : null}
      <div className="ai-model-acts">
        <button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          版の履歴（{versions.length}）を{open ? '畳む' : '開く'}
        </button>
        {admin && active?.playbook ? (
          <button type="button" className="btn sm ghost" aria-expanded={playbookOf === active.version} onClick={() => setPlaybookOf((v) => (v === active.version ? null : active.version))}>
            プレイブック（作り方）を{playbookOf === active.version ? '閉じる' : '見る'}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="ai-table-wrap">
          <table className="ai-versions">
            <thead>
              <tr>
                <th>版</th>
                <th>理由</th>
                <th>何を直したか</th>
                <th>日付</th>
                <th className="r">案</th>
                <th className="r">選ばれた率</th>
                <th className="r">返信率</th>
                <th className="r">総合点</th>
                {admin ? <th>管理</th> : null}
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version} className={v.active ? 'active' : ''}>
                  <td className="num">
                    第 {v.version} 版{v.active ? <Badge tone="navy">使用中</Badge> : null}
                  </td>
                  <td className="origin">{ORIGIN_LABEL[v.origin]}</td>
                  <td className="note">{v.note || '—'}</td>
                  <td className="num">
                    {day(v.createdAt)}
                    <div className="muted">{v.createdBy.split('@')[0]}</div>
                  </td>
                  <td className="num r">{fmtInt(v.stats.drafts)}</td>
                  <td className="num r">{fmtPct(v.stats.chosenRatePct)}</td>
                  <td className="num r">{fmtPct(v.stats.replyRatePct)}</td>
                  <td className="num r">{score(v.stats.score)}</td>
                  {admin ? (
                    <td className="acts">
                      {v.playbook ? (
                        <button type="button" className="btn sm ghost" aria-label={`第 ${v.version} 版のプレイブック`} aria-expanded={playbookOf === v.version} onClick={() => setPlaybookOf((cur) => (cur === v.version ? null : v.version))}>
                          作り方
                        </button>
                      ) : null}
                      {!v.active ? (
                        confirming === v.version ? (
                          <>
                            <button
                              type="button"
                              className="btn sm danger"
                              disabled={busy}
                              onClick={() => {
                                setConfirming(null);
                                onRollback(v.version);
                              }}
                            >
                              戻す
                            </button>
                            <button type="button" className="btn sm ghost" onClick={() => setConfirming(null)}>
                              やめる
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn sm" disabled={busy} aria-label={`第 ${v.version} 版: ${SCOUT_TEXT.rollback}`} onClick={() => setConfirming(v.version)}>
                            {SCOUT_TEXT.rollback}
                          </button>
                        )
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {admin && shownPlaybook?.playbook ? (
        <div className="ai-playbook" role="region" aria-label={`${model.label} 第 ${shownPlaybook.version} 版のプレイブック`}>
          <div className="head">
            <b>プレイブック（第 {shownPlaybook.version} 版）</b>
            <span className="muted small">管理者にだけ表示</span>
          </div>
          <pre>{shownPlaybook.playbook}</pre>
        </div>
      ) : null}
    </section>
  );
}

/**
 * モデルの成績（3 つのモデルごとに、説明・いまの版・成績・版の履歴）と、検証・チューニングの状況。
 * 管理者（models.admin）には、プレイブックの表示・「今すぐ検証・チューニング」・「この版に戻す」を出す。
 */
export function ScoutModelsPanel() {
  const res = useScoutModels();
  const [busy, setBusy] = useState<'tune' | 'rollback' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tune, setTune] = useState<ScoutTuneResponse | null>(null);
  if (res.error && !res.data) return <Notice tone="error">モデルの成績を読み込めませんでした（{res.error.message}）</Notice>;
  if (!res.data) {
    return (
      <section className="card">
        <Skeleton rows={6} />
      </section>
    );
  }
  const data = res.data;
  const labelOf = (id: string) => data.models.find((m) => m.id === id)?.label ?? id;
  const runTune = async () => {
    setBusy('tune');
    setError(null);
    try {
      setTune(await runScoutTune());
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const rollback = async (model: ScoutModel, version: number) => {
    setBusy('rollback');
    setError(null);
    try {
      await rollbackScoutModel(model.id, version);
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="ai-result-body" role="region" aria-label="モデルの成績">
      <section className="card ai-section" aria-label="検証とチューニング">
        <div className="card-head">
          <h2>検証とチューニング</h2>
          {data.admin ? (
            <Button size="sm" variant="primary" loading={busy === 'tune'} disabled={busy !== null} onClick={() => void runTune()}>
              {busy === 'tune' ? '実行しています…' : SCOUT_TEXT.tuneNow}
            </Button>
          ) : null}
        </div>
        <p className="lead">CS がどの案を選んだか・企業が使ったか・返信・採用を集めて、モデルごとに成績を出し、作り方（プレイブック）を直します</p>
        <dl className="ai-kv">
          <div>
            <dt>最後に実行した日時</dt>
            <dd className="num">{data.lastTunedAt ? day(data.lastTunedAt) : 'まだ実行していません'}</dd>
          </div>
          <div>
            <dt>そのときの結果</dt>
            <dd>{data.lastTuneNote || '—'}</dd>
          </div>
          <div>
            <dt>次の自動実行</dt>
            <dd>{data.schedule}</dd>
          </div>
        </dl>
        {error ? (
          <div className="notice error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        {tune ? (
          <div className="ai-tune" role="status" aria-label="検証・チューニングの結果">
            <b>
              実行しました（<span className="num">{day(tune.ranAt)}</span>）。実績を取り込んだ案: <span className="num">{fmtInt(tune.outcomesUpdated)}</span> 件
            </b>
            <ul>
              {tune.results.map((r) => (
                <li key={r.modelId} data-action={r.action}>
                  <span className="nm">{labelOf(r.modelId)}</span>
                  <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                  <span className="num muted">{r.fromVersion === r.toVersion ? `第 ${r.fromVersion} 版のまま` : `第 ${r.fromVersion} 版 → 第 ${r.toVersion} 版`}</span>
                  <span className="note">{r.note}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      {data.models.map((m) => (
        <ModelCard key={m.id} model={m} admin={data.admin} busy={busy !== null} onRollback={(v) => void rollback(m, v)} />
      ))}
    </div>
  );
}
