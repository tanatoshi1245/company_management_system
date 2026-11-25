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

/**
 * AI 機能（docs/AI機能.md）の API 呼び出しと、結果待ちのポーリング。3 機能の画面が共用する。
 * 企業は URL のパスに入れる（本文に入れない）。
 */

const enc = encodeURIComponent;
const historyUrl = (companyId: string, kind: AiKind) => `/api/ai/jobs?company=${enc(companyId)}&kind=${kind}`;

export const useAiConfig = (): Resource<AiConfigResponse> => useResource('/api/ai/config', AiConfigResponseSchema, { ttlMs: 5 * 60_000 });
export const useAiCompanies = (): Resource<AiCompaniesResponse> => useResource('/api/ai/companies', AiCompaniesResponseSchema, { ttlMs: 10 * 60_000 });
export const useAiCompanyDefaults = (companyId: string | null): Resource<AiCompanyDefaultsResponse> =>
  useResource(companyId ? `/api/ai/companies/${enc(companyId)}/defaults` : null, AiCompanyDefaultsResponseSchema, { ttlMs: 10 * 60_000 });
export const useAiHistory = (companyId: string | null, kind: AiKind): Resource<AiJobListResponse> => useResource(companyId ? historyUrl(companyId, kind) : null, AiJobListResponseSchema, { ttlMs: 15_000 });

/** 依頼を作ってセッションを立ち上げる。input は機能ごとの入力（src/shared/ai/{report,scout,job}.ts） */
export async function createAiJob(companyId: string, kind: AiKind, input: unknown): Promise<AiCreateResponse> {
  const res = await apiSend<AiCreateResponse>('POST', `/api/companies/${enc(companyId)}/ai/jobs`, { kind, input }, AiCreateResponseSchema);
  invalidate('/api/ai/jobs?');
  return res;
}

export const fetchAiJob = (jobId: string, signal?: AbortSignal): Promise<AiJobDetail> => apiGet(`/api/ai/jobs/${enc(jobId)}`, AiJobDetailSchema, signal);

/** 未起動・失敗のジョブをもう一度立ち上げる */
export async function refireAiJob(jobId: string): Promise<AiCreateResponse> {
  const res = await apiSend<AiCreateResponse>('POST', `/api/ai/jobs/${enc(jobId)}/fire`, {}, AiCreateResponseSchema);
  invalidate('/api/ai/jobs?');
  return res;
}

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
