import { useCallback, useEffect, useState } from 'react';
import type { AiCompanyOption, AiConfigResponse, AiJobDetail, AiKind } from '../../../../shared/ai/common';
import { ApiError } from '../../../lib/api';
import { clearAiEdited, createAiJob, deleteAiJob, refireAiJob, saveAiEdited, useAiCompanies, useAiConfig, useAiJob } from './aiApi';

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
  /** 実行・立ち上げ直しの最中 */
  busy: boolean;
  error: string | null;
  /** 依頼を作ってセッションを立ち上げる。成功したら true */
  run: (input: unknown) => Promise<boolean>;
  refire: () => Promise<void>;
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
 * ②③ の画面で共通の動き: 設定・企業の一覧・ジョブ 1 件（結果待ちのポーリング）・実行・立ち上げ直し・直した版の保存・履歴からの削除。
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
  const [busy, setBusy] = useState(false);
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
      setBusy(true);
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
        setBusy(false);
      }
    },
    [companyId, kind, show],
  );

  const refire = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const res = await refireAiJob(job.id);
      setFireMessage(res.fireMessage);
      show(res.job);
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [job, show]);

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
    error: error ?? (jobId && !local && remote.error ? aiErrorMessage(remote.error) : null),
    run,
    refire,
    saveEdited,
    clearEdited,
    remove,
    select,
    close,
  };
}
