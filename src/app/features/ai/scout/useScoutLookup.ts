import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../lib/api';
import { aiErrorMessage } from '../common/useAiWorkspace';

/**
 * 求人 ID・会員 ID の内容を確かめる（GET だけ。**AI は動かない**）。
 * key = 何を確かめたか（求人は「企業 ID:求人 ID」、会員は会員 ID）。画面は、いまの入力の key と同じときだけ「確かめた」と扱う
 * （ID や企業を変えると key が変わるので、古い内容では実行できない）。
 */
export interface ScoutLookupState<T> {
  key: string | null;
  status: 'idle' | 'loading' | 'ok' | 'error';
  data: T | null;
  error: string | null;
}

export interface ScoutLookup<T> {
  state: ScoutLookupState<T>;
  /** 確かめる（同じ key でも読み直す） */
  check: (key: string) => void;
  /** まだ確かめていない key のときだけ確かめる（URL・履歴から開いたとき） */
  ensure: (key: string) => void;
  /** 読まずに、誤りだけを出す（ID の書き方が違うとき） */
  fail: (key: string, message: string) => void;
  reset: () => void;
}

const idle = <T,>(): ScoutLookupState<T> => ({ key: null, status: 'idle', data: null, error: null });

export function useScoutLookup<T>(fetcher: (key: string, signal: AbortSignal) => Promise<T>, notFound: string): ScoutLookup<T> {
  const [state, setState] = useState<ScoutLookupState<T>>(idle);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef<string | null>(null);
  const acRef = useRef<AbortController | null>(null);

  const check = useCallback(
    (key: string) => {
      acRef.current?.abort();
      const ac = new AbortController();
      acRef.current = ac;
      keyRef.current = key;
      setState({ key, status: 'loading', data: null, error: null });
      fetcherRef.current(key, ac.signal).then(
        (data) => {
          if (!ac.signal.aborted) setState({ key, status: 'ok', data, error: null });
        },
        (e: unknown) => {
          if (ac.signal.aborted) return;
          setState({ key, status: 'error', data: null, error: e instanceof ApiError && e.status === 404 ? notFound : aiErrorMessage(e) });
        },
      );
    },
    [notFound],
  );
  const ensure = useCallback(
    (key: string) => {
      if (keyRef.current !== key) check(key);
    },
    [check],
  );
  const fail = useCallback((key: string, message: string) => {
    acRef.current?.abort();
    keyRef.current = key;
    setState({ key, status: 'error', data: null, error: message });
  }, []);
  const reset = useCallback(() => {
    acRef.current?.abort();
    keyRef.current = null;
    setState(idle);
  }, []);

  useEffect(() => () => acRef.current?.abort(), []);

  return { state, check, ensure, fail, reset };
}
