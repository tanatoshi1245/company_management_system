import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiSend, ApiError } from '../../../lib/api';
import { invalidate, useResource, type Resource } from '../../../lib/useResource';
import {
  AiCompaniesResponseSchema,
  AiCompanyDefaultsResponseSchema,
  AiConfigResponseSchema,
  AiCreateResponseSchema,
  AiJobDetailSchema,
  AiJobListResponseSchema,
  type AiCompaniesResponse,
  type AiCompanyDefaultsResponse,
  type AiConfigResponse,
  type AiCreateResponse,
  type AiJobDetail,
  type AiJobListResponse,
  type AiKind,
} from '../../../../shared/ai/common';
import {
  ScoutModelsResponseSchema,
  ScoutOptionsResponseSchema,
  ScoutTuneResponseSchema,
  type ScoutChoiceInput,
  type ScoutModelId,
  type ScoutModelsResponse,
  type ScoutOptionsResponse,
  type ScoutTuneResponse,
  type ScoutUsageInput,
} from '../../../../shared/ai/scout';

/**
 * AI 機能（docs/AI機能.md）の API 呼び出し。3 機能の画面が共用する。
 * ② スカウトは、作成の応答（POST）に結果が入っている（十数秒。ポーリングは要らない）。useAiJob のポーリングは、作成中のまま残ったジョブを開いたときのためのもの。
 * 企業は URL のパスに入れる（本文に入れない）。
 */

const enc = encodeURIComponent;
const historyUrl = (companyId: string, kind: AiKind) => `/api/ai/jobs?company=${enc(companyId)}&kind=${kind}`;

export const useAiConfig = (): Resource<AiConfigResponse> => useResource('/api/ai/config', AiConfigResponseSchema, { ttlMs: 5 * 60_000 });
export const useAiCompanies = (): Resource<AiCompaniesResponse> => useResource('/api/ai/companies', AiCompaniesResponseSchema, { ttlMs: 10 * 60_000 });
export const useAiCompanyDefaults = (companyId: string | null): Resource<AiCompanyDefaultsResponse> =>
  useResource(companyId ? `/api/ai/companies/${enc(companyId)}/defaults` : null, AiCompanyDefaultsResponseSchema, { ttlMs: 10 * 60_000 });
export const useAiHistory = (companyId: string | null, kind: AiKind): Resource<AiJobListResponse> => useResource(companyId ? historyUrl(companyId, kind) : null, AiJobListResponseSchema, { ttlMs: 15_000 });

/** 依頼を作る（② スカウトは、応答に結果が入っている）。input は機能ごとの入力（src/shared/ai/{report,scout,job}.ts） */
export async function createAiJob(companyId: string, kind: AiKind, input: unknown): Promise<AiCreateResponse> {
  const res = await apiSend<AiCreateResponse>('POST', `/api/companies/${enc(companyId)}/ai/jobs`, { kind, input }, AiCreateResponseSchema);
  invalidate('/api/ai/jobs?');
  return res;
}

export const fetchAiJob = (jobId: string, signal?: AbortSignal): Promise<AiJobDetail> => apiGet(`/api/ai/jobs/${enc(jobId)}`, AiJobDetailSchema, signal);

/** 画面で直した版を保存する（result は結果と同じ形） */
export async function saveAiEdited(jobId: string, result: unknown): Promise<AiJobDetail> {
  const res = await apiSend<AiJobDetail>('PUT', `/api/ai/jobs/${enc(jobId)}/edited`, { result }, AiJobDetailSchema);
  invalidate('/api/ai/jobs?');
  return res;
}

/** 直した版を捨てて、元の結果に戻す */
export async function clearAiEdited(jobId: string): Promise<AiJobDetail> {
  const res = await apiSend<AiJobDetail>('DELETE', `/api/ai/jobs/${enc(jobId)}/edited`, undefined, AiJobDetailSchema);
  invalidate('/api/ai/jobs?');
  return res;
}

export async function deleteAiJob(jobId: string): Promise<void> {
  await apiSend<{ ok: true }>('DELETE', `/api/ai/jobs/${enc(jobId)}`);
  invalidate('/api/ai/jobs?');
}

/* ---------- ② スカウト: 条件の選択肢・選択と利用の記録・モデルの成績 ---------- */

const SCOUT_MODELS_URL = '/api/ai/scout/models';

/** 受け取る人の条件の選択肢（マートにある値） */
export const useScoutOptions = (): Resource<ScoutOptionsResponse> => useResource('/api/ai/scout/options', ScoutOptionsResponseSchema, { ttlMs: 30 * 60_000 });

/** どの案を選んだか（draftId = null は「どれも使わない」） */
export async function putScoutChoice(jobId: string, input: ScoutChoiceInput): Promise<AiJobDetail> {
  const res = await apiSend<AiJobDetail>('PUT', `/api/ai/jobs/${enc(jobId)}/scout/choice`, input, AiJobDetailSchema);
  invalidate(SCOUT_MODELS_URL);
  return res;
}

/** 選んだ案を企業が使ったか */
export async function putScoutUsage(jobId: string, input: ScoutUsageInput): Promise<AiJobDetail> {
  const res = await apiSend<AiJobDetail>('PUT', `/api/ai/jobs/${enc(jobId)}/scout/usage`, input, AiJobDetailSchema);
  invalidate(SCOUT_MODELS_URL);
  return res;
}

/** モデルの成績と版の履歴 */
export const useScoutModels = (enabled = true): Resource<ScoutModelsResponse> => useResource(enabled ? SCOUT_MODELS_URL : null, ScoutModelsResponseSchema, { ttlMs: 60_000 });

/** 検証・チューニングを今すぐ実行する（管理者） */
export async function runScoutTune(): Promise<ScoutTuneResponse> {
  const res = await apiSend<ScoutTuneResponse>('POST', '/api/ai/scout/tune', {}, ScoutTuneResponseSchema);
  invalidate(SCOUT_MODELS_URL);
  return res;
}

/** モデルを前の版に戻す（管理者） */
export async function rollbackScoutModel(modelId: ScoutModelId, version: number): Promise<ScoutModelsResponse> {
  const res = await apiSend<ScoutModelsResponse>('POST', `${SCOUT_MODELS_URL}/${enc(modelId)}/rollback`, { version }, ScoutModelsResponseSchema);
  invalidate(SCOUT_MODELS_URL);
  return res;
}

/** 結果待ちの間に見に行く間隔（ミリ秒） */
export const AI_POLL_MS = 5_000;

export interface AiJobState {
  job: AiJobDetail | null;
  error: ApiError | Error | null;
  loading: boolean;
  /** 結果待ち（running）で、見に行っている最中か */
  polling: boolean;
  /** 手元の内容を差し替える（作成の応答・保存の応答をそのまま入れる） */
  setJob: (job: AiJobDetail | null) => void;
  reload: () => Promise<void>;
}

/**
 * 1 件のジョブ。jobId を渡すと読み込み、running の間は AI_POLL_MS ごとに見に行く（done / failed で止まる）。
 * 作成の応答で受け取ったジョブは setJob で入れる（サンプルデータのときの見本は保存されないので、読み直さない = sample のジョブは取りに行かない）。
 */
export function useAiJob(jobId: string | null): AiJobState {
  const [job, setJobState] = useState<AiJobDetail | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(false);
  const jobRef = useRef<AiJobDetail | null>(null);
  jobRef.current = job;

  const setJob = useCallback((j: AiJobDetail | null) => {
    setJobState(j);
    setError(null);
  }, []);

  const load = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      const j = await fetchAiJob(id, signal);
      if (signal?.aborted) return;
      setJobState(j);
      setError(null);
      if (j.status === 'done' || j.status === 'failed') invalidate('/api/ai/jobs?');
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);

  // jobId が変わったら読み込む（手元に同じ ID のジョブがあれば、そのまま使う）
  useEffect(() => {
    if (!jobId) {
      setJobState(null);
      setError(null);
      return;
    }
    if (jobRef.current?.id === jobId) return;
    const ac = new AbortController();
    setJobState(null);
    setLoading(true);
    void load(jobId, ac.signal).finally(() => {
      if (!ac.signal.aborted) setLoading(false);
    });
    return () => ac.abort();
  }, [jobId, load]);

  const running = job !== null && job.status === 'running' && !job.sample;
  const runningId = running ? job.id : null;
  useEffect(() => {
    if (!runningId) return;
    const ac = new AbortController();
    const timer = window.setInterval(() => void load(runningId, ac.signal), AI_POLL_MS);
    return () => {
      ac.abort();
      window.clearInterval(timer);
    };
  }, [runningId, load]);

  const reload = useCallback(async () => {
    const id = jobRef.current?.id ?? jobId;
    if (id && !jobRef.current?.sample) await load(id);
  }, [jobId, load]);

  return { job, error, loading, polling: running, setJob, reload };
}
