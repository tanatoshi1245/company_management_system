import type { D1Like } from './db';

/** app_meta: cache_epoch（手動でキャッシュを捨てるための版）など */
export class AppMetaRepo {
  constructor(private readonly db: D1Like) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT value FROM app_meta WHERE key = ?1').bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  async cacheEpoch(): Promise<string> {
    return (await this.get('cache_epoch')) ?? '1';
  }

  /** cache_epoch を +1 して返す */
  async bumpCacheEpoch(actor: string, nowIso: string): Promise<string> {
    const cur = Number(await this.cacheEpoch()) || 1;
    const next = String(cur + 1);
    await this.db
      .prepare('INSERT INTO app_meta (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
      .bind('cache_epoch', next, actor, nowIso)
      .run();
    return next;
  }
}
