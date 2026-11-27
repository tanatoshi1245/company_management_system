import { useCallback, useEffect, useState } from 'react';
import type { AiCompanyOption, AiConfigResponse, AiJobDetail, AiKind } from '../../../../shared/ai/common';
import { ApiError } from '../../../lib/api';
import { clearAiEdited, createAiJob, deleteAiJob, saveAiEdited, useAiCompanies, useAiConfig, useAiJob } from './aiApi';

/** API の誤りを、画面に出す 1 つの文にする（項目ごとの理由があれば添える） */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.details.length) return `${e.message}（${e.details.map((d) => d.message).join(' / ')}）`;
  return e instanceof Error ? e.message : String(e);
}

export interface AiWorkspace {
  config: AiConfigResponse | null;
  companies: AiCompanyOption[];
  companiesLoading: boolean;
  company: AiCompanyOption | null;
  /** 書き込めるか（Google ログイン済み。config を読むまでは false） */
  canWrite: boolean;
  /** いま開いているジョブ（作成の応答で受け取った見本、または URL のジョブ） */
  job: AiJobDetail | null;
  jobLoading: boolean;
  polling: boolean;
  fireMessage: string | null;
  /** 実行の最中（② スカウトは、この間に Worker が分析と作成をしている） */
  busy: boolean;
  /** 実行を始めた時刻（ミリ秒。busy の間だけ） */
  busySince: number | null;
  error: string | null;
  /** 依頼を作る。応答のジョブを開く（作れなかったとき = fire: failed も、失敗のジョブとして開く）。応答が返ったら true */
  run: (input: unknown) => Promise<boolean>;
  /** 開いているジョブを差し替える（選択・利用の記録の応答をそのまま入れる） */
  replace: (job: AiJobDetail) => void;
  /** 画面で直した版を保存する（結果と同じ形）。失敗したら例外 */
  saveEdited: (result: unknown) => Promise<void>;
  clearEdited: () => Promise<void>;
  remove: (jobId: string) => Promise<void>;
  /** 履歴から開く */
  select: (jobId: string) => void;
  /** 開いている結果を閉じる（企業を変えたときなど） */
  close: () => void;
}

/**
 * AI 機能の画面で共通の動き: 設定・企業の一覧・ジョブ 1 件・実行・直した版の保存・履歴からの削除。
 * 失敗した依頼は、同じ入力で run をもう一度呼ぶ（= 新しい依頼。立ち上げ直しの API は 2026-11-27 に無くなった）。
 * 企業とジョブ ID は画面が URL に持ち、ここへ渡す。
 * サンプルデータの見本（保存されないことがある）は URL に入れず、手元に持つ。
 */
export function useAiWorkspace(opts: { kind: AiKind; companyId: string | null; jobId: string | null; setJobId: (jobId: string | null) => void }): AiWorkspace {
  const { kind, companyId, jobId, setJobId } = opts;
  const config = useAiConfig();
  const companies = useAiCompanies();
  const remote = useAiJob(jobId);
  const [local, setLocal] = useState<AiJobDetail | null>(null);
  const [fireMessage, setFireMessage] = useState<string | null>(null);
  const [busySince, setBusySince] = useState<number | null>(null);
  const busy = busySince !== null;
  const [error, setError] = useState<string | null>(null);

  const job = local ?? (jobId ? remote.job : null);
  const list = companies.data?.companies ?? [];
  const company = companyId ? list.find((c) => c.id === companyId) ?? null : null;

  // URL のジョブが変わったら（履歴から開いた・戻る）、手元の見本を外す
  useEffect(() => {
    if (jobId) setLocal(null);
  }, [jobId]);

  // 企業を変えたら、前の企業の見本を外す
  useEffect(() => setLocal(null), [companyId]);

  const show = useCallback(
    (j: AiJobDetail) => {
      if (j.sample) {
        setLocal(j);
        setJobId(null);
      } else {
        setLocal(null);
        remote.setJob(j);
        setJobId(j.id);
      }
    },
    [remote.setJob, setJobId],
  );

  const run = useCallback(
    async (input: unknown): Promise<boolean> => {
      if (!companyId) return false;
      setBusySince(Date.now());
      setError(null);
      setFireMessage(null);
      try {
        const res = await createAiJob(companyId, kind, input);
        setFireMessage(res.fireMessage);
        show(res.job);
        return true;
      } catch (e) {
        setError(aiErrorMessage(e));
        return false;
      } finally {
        setBusySince(null);
      }
    },
    [companyId, kind, show],
  );

  const put = useCallback(
    (j: AiJobDetail) => {
      if (local) setLocal(j);
      else remote.setJob(j);
    },
    [local, remote.setJob],
  );

  const saveEdited = useCallback(
    async (result: unknown) => {
      if (!job) return;
      try {
        put(await saveAiEdited(job.id, result));
      } catch (e) {
        // 保存されていない見本は、この画面の中でだけ直した版を持つ
        if (job.sample && e instanceof ApiError && (e.status === 404 || e.status === 403)) put({ ...job, editedResult: result, edited: true });
        else throw new Error(aiErrorMessage(e));
      }
    },
    [job, put],
  );

  const clearEdited = useCallback(async () => {
    if (!job) return;
    try {
      put(await clearAiEdited(job.id));
    } catch (e) {
      if (job.sample && e instanceof ApiError && (e.status === 404 || e.status === 403)) put({ ...job, editedResult: null, edited: false });
      else throw new Error(aiErrorMessage(e));
    }
  }, [job, put]);

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteAiJob(id);
        if (id === jobId) setJobId(null);
        if (id === local?.id) setLocal(null);
      } catch (e) {
        setError(aiErrorMessage(e));
      }
    },
    [jobId, local, setJobId],
  );

  const select = useCallback(
    (id: string) => {
      setLocal(null);
      setError(null);
      setFireMessage(null);
      setJobId(id);
    },
    [setJobId],
  );
  const close = useCallback(() => {
    setLocal(null);
    setFireMessage(null);
    setJobId(null);
  }, [setJobId]);

  return {
    config: config.data,
    companies: list,
    companiesLoading: companies.loading,
    company,
    // サンプルデータ中は、仮の利用者でも実行できる（見本が返る。保存はされない）
    canWrite: Boolean(config.data?.canWrite || config.data?.sampleMode),
    job,
    jobLoading: Boolean(jobId) && !local && remote.loading,
    polling: !local && remote.polling,
    fireMessage,
    busy,
    busySince,
    error: error ?? (jobId && !local && remote.error ? aiErrorMessage(remote.error) : null),
    run,
    replace: put,
    saveEdited,
    clearEdited,
    remove,
    select,
    close,
  };
}
