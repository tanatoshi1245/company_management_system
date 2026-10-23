import { useCallback, useMemo } from 'react';
import type { z } from 'zod';
import { navigate, useLocation } from '../router';

/**
 * URL のクエリ文字列を状態として扱う（再読み込み・共有・戻るで絞り込みが保たれる）。
 * schema は各項目に default を持つ zod オブジェクト。既定値と同じ項目は URL から外す
 */
export function useUrlState<T extends Record<string, unknown>>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, defaults: T): [T, (patch: Partial<T>) => void] {
  const { pathname, search } = useLocation();
  const state = useMemo(() => {
    const raw: Record<string, string> = {};
    new URLSearchParams(search).forEach((v, k) => (raw[k] = v));
    const r = schema.safeParse(raw);
    return r.success ? r.data : defaults;
  }, [schema, search, defaults]);
  const set = useCallback(
    (patch: Partial<T>) => {
      const next = { ...state, ...patch } as T;
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null || v === '' || JSON.stringify(v) === JSON.stringify(defaults[k])) continue;
        q.set(k, Array.isArray(v) ? v.join(',') : String(v));
      }
      const qs = q.toString();
      navigate(`${pathname}${qs ? `?${qs}` : ''}`, { replace: true });
    },
    [state, pathname, defaults],
  );
  return [state, set];
}
