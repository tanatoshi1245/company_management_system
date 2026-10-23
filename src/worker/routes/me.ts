import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { isMock } from '../env';
import { asD1 } from '../d1/db';
import { SettingsRepo } from '../d1/settingsRepo';
import type { MeResponse } from '../../shared/schema/me';

export const meRoutes = new Hono<AppEnv>();

/** ログイン者。担当=自分 の判定は board 側（マスタの担当メール + D1 上書き）で行い、ここでは上書きで担当になっている企業 ID だけ返す */
meRoutes.get('/me', async (c) => {
  const identity = c.get('identity');
  const mode = c.get('authMode');
  const overrideCompanyIds = identity && c.env.CMS_DB ? await new SettingsRepo(asD1(c.env.CMS_DB)).companyIdsOwnedBy(identity.email).catch(() => []) : [];
  const body: MeResponse = {
    email: identity?.email ?? null,
    name: identity?.name ?? null,
    verified: Boolean(identity?.verified),
    authMode: mode,
    mock: isMock(c.env),
    ownerUserId: null,
    overrideCompanyIds,
    canEdit: Boolean(identity?.verified && c.env.CMS_DB),
    ...(mode === 'google' ? { loginUrl: '/auth/login', logoutUrl: '/auth/logout' } : {}),
  };
  return c.json(body);
});
