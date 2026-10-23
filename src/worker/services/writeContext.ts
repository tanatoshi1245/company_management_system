import type { Ctx } from '../types';
import { AppError } from '../lib/errors';
import { asD1, type D1Like } from '../d1/db';
import { makeClient } from './clients';
import { companyMasterByIdQuery } from '../sql/companyDetail';
import type { BqClient } from '../bq/client';

/** D1 が束ねられていなければ 503（目標・設定は D1 無しでは扱えない） */
export function requireDb(c: Ctx): D1Like {
  if (!c.env.CMS_DB) throw new AppError('storage', 503, '保存先（D1）が設定されていません。管理者に連絡してください');
  return asD1(c.env.CMS_DB);
}

/** 書き込みの主体（requireVerified の後で呼ぶ） */
export function actorOf(c: Ctx): { email: string; requestId: string } {
  const id = c.get('identity');
  if (!id?.verified) throw new AppError('readOnly', 403, '書き込みには Google ログインが必要です');
  return { email: id.email.toLowerCase(), requestId: c.get('requestId') };
}

/** 企業がマスタに存在することを確かめる（存在しなければ 404。URL の ID を信用しない） */
export async function assertCompanyExists(client: BqClient, companyId: string): Promise<{ name: string; plan: string | null }> {
  const row = (await client.run(companyMasterByIdQuery(companyId))).rows[0];
  if (!row) throw new AppError('notFound', 404, '企業が見つかりません');
  return { name: String(row.company_name ?? ''), plan: row.plan_name === null || row.plan_name === undefined ? null : String(row.plan_name) };
}

export function clientOf(c: Ctx): BqClient {
  return makeClient(c.env);
}
