import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { requireVerified } from '../auth/middleware';
import { logEvent } from '../lib/log';
import { nowIso } from '../d1/db';
import { AppMetaRepo } from '../d1/appMetaRepo';
import { AuditRepo } from '../d1/auditRepo';
import { actorOf, requireDb } from '../services/writeContext';

export const adminRoutes = new Hono<AppEnv>();

/** マートを手動で再実行したあとに Worker のキャッシュを捨てる（cache_epoch +1） */
adminRoutes.post('/admin/cache/bump', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const meta = new AppMetaRepo(db);
  const before = await meta.cacheEpoch();
  const at = nowIso();
  const cacheEpoch = await meta.bumpCacheEpoch(actor.email, at);
  await new AuditRepo(db).insertStmt({ at, actor: actor.email, action: 'update', entity: 'app_meta', entityId: 'cache_epoch', companyId: null, before: { value: before }, after: { value: cacheEpoch }, requestId: actor.requestId }).run();
  logEvent('admin.cacheBump', { reqId: actor.requestId, actor: actor.email, cacheEpoch });
  return c.json({ cacheEpoch });
});
