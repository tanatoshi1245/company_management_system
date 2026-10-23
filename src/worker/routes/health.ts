import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { isMock } from '../env';
import { googleConfig } from '../auth/middleware';
import { parseAllowList } from '../auth/allowlist';
import { todayJst } from '../../shared/calendar/periods';
import { DATA_VERSION } from '../../shared/schema/common';
import type { HealthResponse } from '../../shared/schema/me';

export const healthRoutes = new Hono<AppEnv>();

/** 設定の診断。値は返さず「設定されているか」だけを返す（ログイン後にだけ見える）。変数・Secret の名前も出さない */
healthRoutes.get('/health', (c) => {
  const allow = parseAllowList(c.env.ALLOWED_EMAILS, c.env.ALLOWED_EMAIL_DOMAINS);
  const body: HealthResponse = {
    ok: true,
    asOf: todayJst(),
    mock: isMock(c.env),
    bqKeyConfigured: Boolean(c.env.BQ_SA_KEY?.trim()),
    d1Configured: Boolean(c.env.CMS_DB),
    authMode: c.get('authMode'),
    googleLoginConfigured: Boolean(googleConfig(c.env).cfg),
    allowedDomains: Array.from(allow.domains),
    allowedEmailsCount: allow.emails.size,
    dataVersion: DATA_VERSION,
  };
  return c.json(body);
});
