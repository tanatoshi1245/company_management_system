import type { Env } from '../env';
import { safeFetch } from '../lib/safeFetch';
import { parseAllowList } from '../auth/allowlist';

/**
 * セッションの発火（claude.ai のスケジュールタスクの API トリガー。従量課金の API キーは使わない）。
 * 複製元: slide_creator の src/worker/requests.ts（fireRoutine・routineIdOf・routineTokenOf・fireDiagnostics）。
 * 変更点: Secret の名前（AI_ROUTINE_ID・AI_ROUTINE_TOKEN）、宛先の固定は safeFetch の許可リスト。
 */
export const FIRE_HOST = 'api.anthropic.com';

/** Secret の貼り方のゆれを吸収する: 発火用の URL や curl の行ごと貼られても、その中の `trig_…` を使う */
export function routineIdOf(raw: string | undefined): string {
  const t = (raw ?? '').trim().replace(/^["']|["']$/g, '');
  return /trig_[A-Za-z0-9_-]+/.exec(t)?.[0] ?? t;
}
/** 先頭の `Bearer ` や、前後の引用符・空白を外す */
export function routineTokenOf(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^(authorization:\s*)?bearer\s+/i, '')
    .trim();
}

export const aiFireConfigured = (env: Env): boolean => Boolean(routineIdOf(env.AI_ROUTINE_ID) && routineTokenOf(env.AI_ROUTINE_TOKEN));

/** 設定の形の診断（値は返さない）。/api/health と、失敗したときの案内に使う */
export function aiFireDiagnostics(env: Env) {
  const id = routineIdOf(env.AI_ROUTINE_ID);
  const token = routineTokenOf(env.AI_ROUTINE_TOKEN);
  return {
    store: Boolean(env.CMS_DB),
    routineId: !id ? 'missing' : /^trig_[A-Za-z0-9_-]+$/.test(id) ? 'ok' : 'unexpectedFormat',
    routineToken: !token ? 'missing' : token.startsWith('sk-ant-oat') ? 'ok' : 'unexpectedFormat',
    admins: parseAllowList(env.AI_ADMIN_EMAILS).emails.size,
  } as const;
}

/** 応答に秘密が混ざらないよう、トークンらしい文字列（発火のトークン・合言葉の 64 桁の hex）を消して短くする */
export const scrub = (t: string): string => t.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[token]').replace(/\b[0-9a-f]{64}\b/g, '[token]').slice(0, 200);

export type FireResult = { ok: true; sessionUrl: string } | { ok: false; status: number; message: string };

/** スケジュールタスクを発火する。返り値はセッションの URL。失敗のときは、原因が分かるように HTTP の状態と API のエラーの種類を添える（値は出さない） */
export async function fireRoutine(env: Env, text: string, fetchImpl: typeof fetch = safeFetch): Promise<FireResult> {
  let res: Response;
  try {
    res = await fetchImpl(`https://${FIRE_HOST}/v1/claude_code/routines/${encodeURIComponent(routineIdOf(env.AI_ROUTINE_ID))}/fire`, {
      method: 'POST',
      headers: { authorization: `Bearer ${routineTokenOf(env.AI_ROUTINE_TOKEN)}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    return { ok: false, status: 0, message: `発火の API に接続できませんでした（${scrub(e instanceof Error ? e.message : String(e))}）。` };
  }
  const raw = await res.text().catch(() => '');
  let json: { claude_code_session_url?: string; claude_code_session_id?: string; error?: { type?: string; message?: string } } | null = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* JSON でない応答 */
  }
  if (res.ok) {
    const url = json?.claude_code_session_url ?? (json?.claude_code_session_id ? `https://claude.ai/code/${json.claude_code_session_id}` : null);
    if (url) return { ok: true, sessionUrl: url };
    return { ok: false, status: res.status, message: `発火の API は成功を返しましたが、セッションの URL がありませんでした（HTTP ${res.status}）。claude.ai のセッションの一覧を確かめてください。` };
  }
  const hint =
    res.status === 401
      ? 'トークンが、このタスクのものと合いません（Secret AI_ROUTINE_TOKEN。タスクの画面で作り直したら貼り替える）。'
      : res.status === 404
        ? 'タスクが見つかりません（Secret AI_ROUTINE_ID。`trig_` で始まる ID）。'
        : res.status === 403
          ? 'このアカウント・組織では、タスクの発火が許可されていません。'
          : res.status === 429
            ? '発火の上限（1 時間あたり）に達しました。しばらくしてからもう一度お試しください。'
            : res.status === 400
              ? 'タスクが一時停止中か、リクエストの形式が合いません。'
              : '時間をおいて、もう一度お試しください。';
  const apiErr = json?.error ? `${json.error.type ?? 'error'}: ${scrub(json.error.message ?? '')}` : scrub(raw);
  return { ok: false, status: res.status, message: `セッションを立ち上げられませんでした（HTTP ${res.status}）。${hint}${apiErr ? `（${apiErr}）` : ''}` };
}
