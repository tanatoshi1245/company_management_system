import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, ApiError, type Schema } from './api';

interface Entry {
  data: unknown;
  at: number;
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

/** url の先頭一致でキャッシュを捨てる（書き込み後に呼ぶ）。マウント中の画面は再取得する */
export function invalidate(prefix: string): void {
  for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) cache.delete(k);
  for (const l of listeners) l();
}

export function clearResourceCache(): void {
  cache.clear();
}

async function load<T>(url: string, schema?: Schema<T>): Promise<T> {
  const cur = inflight.get(url) as Promise<T> | undefined;
  if (cur) return cur;
  const p = apiGet<T>(url, schema)
    .then((data) => {
      cache.set(url, { data, at: Date.now() });
      return data;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/** 行ホバー等での先読み。失敗は無視 */
export function prefetch<T>(url: string, schema?: Schema<T>): void {
  if (cache.has(url) || inflight.has(url)) return;
  load(url, schema).catch(() => undefined);
}

export interface Resource<T> {
  data: T | null;
  error: ApiError | Error | null;
  /** 初回取得中（キャッシュが無い） */
  loading: boolean;
  /** 裏で取り直し中（キャッシュを表示したまま） */
  refreshing: boolean;
  refetch: () => Promise<void>;
}

/**
 * fetch + モジュール内キャッシュ + stale-while-revalidate。url が null なら何もしない。
 * ttlMs より古いキャッシュは表示しつつ裏で取り直す
 */
export function useResource<T>(url: string | null, schema?: Schema<T>, opts: { ttlMs?: number } = {}): Resource<T> {
  const ttl = opts.ttlMs ?? 60_000;
  const cached = url ? (cache.get(url) as Entry | undefined) : undefined;
  const [data, setData] = useState<T | null>((cached?.data as T) ?? null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url) && !cached);
  const [refreshing, setRefreshing] = useState(false);
  const urlRef = useRef(url);
  urlRef.current = url;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const run = useCallback(
    async (force: boolean) => {
      const u = urlRef.current;
      if (!u) return;
      const hit = cache.get(u);
      if (hit && !force && Date.now() - hit.at < ttl) {
        setData(hit.data as T);
        setLoading(false);
        setError(null);
        return;
      }
      if (hit) {
        setData(hit.data as T);
        setLoading(false);
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const d = await load<T>(u, schema);
        if (urlRef.current === u) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (urlRef.current === u) setError(e as Error);
      } finally {
        if (urlRef.current === u) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [schema, ttl],
  );

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);

  const refetch = useCallback(() => run(true), [run]);
  return { data, error, loading, refreshing, refetch };
}
