/**
 * セッションが結果を返すときの合言葉（docs/AI機能.md）。
 * 32 バイトの乱数を hex にしたもの。D1 には SHA-256 のハッシュだけを置き、平文はセッションへ渡す文にだけ入れる。
 */
const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function newToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

/** 定数時間の比較（長さが違っても、長い方の全体を見る） */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Authorization: Bearer の合言葉が、D1 のハッシュと合うか */
export async function tokenMatches(presented: string, storedHash: string | null): Promise<boolean> {
  // ハッシュが無いときも同じ量の計算をする（有無で時間が変わらないように）
  const h = await hashToken(presented);
  return timingSafeEqual(h, storedHash ?? '0'.repeat(64)) && storedHash !== null;
}

/** ジョブ ID（英小文字と数字。時刻 + 8 バイトの乱数） */
export function newJobId(now: Date = new Date()): string {
  return now.getTime().toString(36) + hex(crypto.getRandomValues(new Uint8Array(8)));
}
