import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { MeResponseSchema, MetaResponseSchema, type MeResponse, type MetaResponse } from '../../shared/schema/me';
import { apiGet, ApiError } from './api';

export interface Session {
  me: MeResponse | null;
  meta: MetaResponse | null;
  loading: boolean;
  /** 401: ログインへ。それ以外: 画面に出す */
  error: ApiError | Error | null;
  reload: () => void;
}

const SessionContext = createContext<Session>({ me: null, meta: null, loading: true, error: null, reload: () => undefined });

/** ログイン者と鮮度（/api/me と /api/meta）を 1 度だけ取る */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    Promise.all([apiGet('/api/me', MeResponseSchema, ac.signal), apiGet('/api/meta', MetaResponseSchema, ac.signal)])
      .then(([m, t]) => {
        setMe(m);
        setMeta(t);
        setError(null);
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setError(e);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [n]);
  return <SessionContext.Provider value={{ me, meta, loading, error, reload: () => setN((x) => x + 1) }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
