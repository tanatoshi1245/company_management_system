import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError, type ErrorDetail } from './errors';

function issues(err: z.ZodError): ErrorDetail[] {
  return err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

/** クエリ文字列を zod で検証する。失敗は 400 badRequest（details に項目ごとの理由） */
export function parseQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw new AppError('badRequest', 400, '入力が不正です', issues(r.error));
  return r.data;
}

/** JSON 本文を zod で検証する。JSON でなければ 400 */
export async function parseJson<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError('badRequest', 400, 'JSON 本文が必要です');
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError('badRequest', 400, '入力が不正です', issues(r.error));
  return r.data;
}

/** パスパラメータを zod で検証する。失敗は 404 扱い（存在しない ID の列挙に手がかりを与えない） */
export function parseParam<T extends z.ZodTypeAny>(raw: string | undefined, schema: T): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError('notFound', 404, '見つかりません');
  return r.data;
}
