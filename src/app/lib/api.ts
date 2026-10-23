import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    /** 401 のとき: ログイン画面の URL */
    public readonly login: string | null = null,
    public readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function handle<T>(res: Response, schema?: z.ZodType<T>): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* noop */
  }
  if (!res.ok) {
    const err = (json as { error?: string; code?: string; login?: string; details?: { path: string; message: string }[] } | null) ?? {};
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status, err.code ?? 'http', err.login ?? null, err.details ?? []);
  }
  // 開発時だけ応答の形を検証する（本番は速度優先でそのまま）
  if (schema && import.meta.env.DEV) {
    const r = schema.safeParse(json);
    if (!r.success) {
      console.warn('API 応答の形が想定と違います', r.error.issues.slice(0, 5));
      return json as T;
    }
    return r.data;
  }
  return json as T;
}

export async function apiGet<T>(url: string, schema?: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  return handle<T>(await fetch(url, { signal, headers: { accept: 'application/json' } }), schema);
}

/** 書き込み。同一オリジン判定のため Content-Type を付ける（Worker 側の sameOriginGuard） */
export async function apiSend<T>(method: 'PUT' | 'POST' | 'DELETE', url: string, body?: unknown, schema?: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  return handle<T>(res, schema);
}
