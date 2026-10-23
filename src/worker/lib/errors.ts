import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { BqError } from '../bq/client';

export interface ErrorDetail {
  path: string;
  message: string;
}

/** 画面に返してよいエラー。message は利用者向けの文言（内部情報を含めない） */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

/**
 * エラー応答の形: { error, code, details? }。スタックトレース・SQL・内部ホスト名・Secret は返さない（ログにだけ出す）。
 * BigQuery のエラー文には SQL の断片が混ざりうるので、画面には理由コードだけを返す。
 */
export function errorResponse(err: unknown, c: Context): Response {
  if (err instanceof AppError) {
    if (err.status >= 500) console.error(err);
    return c.json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) }, err.status as ContentfulStatusCode);
  }
  if (err instanceof BqError) {
    console.error(`BigQuery error [${err.reason}] ${err.status ?? ''}: ${err.message}`);
    if (err.reason === 'noCredentials') return c.json({ error: err.message, code: 'noCredentials' }, 500);
    const status = err.status === 403 ? 502 : err.reason === 'timeout' ? 504 : 502;
    return c.json({ error: 'データの取得に失敗しました。時間をおいて再度お試しください', code: 'bq', reason: err.reason }, status as ContentfulStatusCode);
  }
  const msg = err instanceof Error ? err.message : String(err);
  // D1 の表が無い = マイグレーション未適用（設定不足を画面で分かるようにする。SQL やスタックは出さない）
  if (/no such table|D1_ERROR/i.test(msg)) {
    console.error(`D1 error: ${msg}`);
    return c.json({ error: 'D1 のマイグレーションが適用されていません。D1 コンソールで d1/migrations/0001_init.sql と 0002_plan_defaults.sql を順に実行してください（docs/デプロイ手順.md 3）', code: 'storage' }, 503);
  }
  // SA 鍵の形式不正（Secret の貼り間違い）
  if (/^BQ_SA_KEY/.test(msg)) {
    console.error(`BQ key error: ${msg}`);
    return c.json({ error: `${msg}。Secret BQ_SA_KEY を 1 行の JSON で貼り直してください（docs/Google_Cloud認証情報の発行手順.md）`, code: 'noCredentials' }, 500);
  }
  console.error(err);
  return c.json({ error: 'サーバー内部でエラーが発生しました', code: 'internal' }, 500);
}
