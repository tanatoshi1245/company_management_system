import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { isMock } from '../env';
import type { MeResponse } from '../../shared/schema/me';

export const meRoutes = new Hono<AppEnv>();

/** ログイン者。担当との対応（マスタの担当メールが一致する企業）は M1 で board 側に付ける */
meRoutes.get('/me', (c) => {
  const identity = c.get('identity');
  const mode = c.get('authMode');
  const body: MeResponse = {
    email: identity?.email ?? null,
    name: identity?.name ?? null,
    verified: Boolean(identity?.verified),
    authMode: mode,
    mock: isMock(c.env),
    ownerUserId: null,
    overrideCompanyIds: [],
    canEdit: Boolean(identity?.verified && c.env.CMS_DB),
    ...(mode === 'google' ? { loginUrl: '/auth/login', logoutUrl: '/auth/logout' } : {}),
  };
  return c.json(body);
});
