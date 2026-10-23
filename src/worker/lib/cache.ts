// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
/** Cache API を使った応答キャッシュ（KV 不要・wrangler dev でも動く） */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export async function cacheKey(ns: string, payload: unknown): Promise<Request> {
  const h = await sha256Hex(canonicalJson(payload));
  return new Request(`https://cache.local/v1/${ns}/${h}`, { method: 'GET' });
}

function getCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

export async function cacheGet<T>(key: Request): Promise<T | null> {
  const cache = getCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    if (!hit) return null;
    return (await hit.json()) as T;
  } catch {
    return null;
  }
}

/** body が文字列なら JSON 済みとしてそのまま使う（大きな応答を二度 stringify しない） */
export async function cachePut(key: Request, body: unknown, maxAgeSec: number, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
  const cache = getCache();
  if (!cache) return;
  const res = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAgeSec}` },
  });
  const put = cache.put(key, res).catch(() => undefined);
  if (ctx) ctx.waitUntil(put);
  else await put;
}
