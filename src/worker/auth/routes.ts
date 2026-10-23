// 複製元: sales_dashboard_IS-FS_ver2 の src/worker/index.ts の /auth/* 部分。変更点: サブアプリに分離、Cookie 名、文言。
import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../types';
import { isEmailAllowed, notAllowedMessage, parseAllowList } from './allowlist';
import { googleConfig } from './middleware';
import { authPage } from './pages';
import { buildAuthUrl, exchangeCode, parseCookies, pkceChallenge, randomToken, safeReturnPath, serializeCookie, SESSION_COOKIE, signPayload, STATE_COOKIE, STATE_TTL_SEC, verifyGoogleIdToken, verifyPayload, type SessionPayload, type StatePayload } from './google';

const nowSec = () => Math.floor(Date.now() / 1000);
const isHttps = (c: Ctx) => new URL(c.req.url).protocol === 'https:';
const callbackUrl = (c: Ctx) => `${new URL(c.req.url).origin}/auth/callback`;

/** 設定不足のときの公開ページ。足りない Secret の名前は画面に出さず Worker のログにだけ出す */
const noGoogle = (c: Ctx) => {
  console.error(`Google ログインの設定不足: ${googleConfig(c.env).missing.join(', ') || 'GOOGLE_CLIENT_ID'}（docs/デプロイ手順.md）`);
  return authPage(c, 503, 'ログインの設定が完了していません', '管理者に連絡してください。', false);
};

export const authRoutes = new Hono<AppEnv>();

/** Google の認可画面へ。state と PKCE の verifier を署名付き Cookie に入れておく */
authRoutes.get('/login', async (c) => {
  const { cfg } = googleConfig(c.env);
  if (!cfg) return noGoogle(c);
  const state = randomToken(16);
  const verifier = randomToken(32);
  const payload: StatePayload = { kind: 'state', state, verifier, returnTo: safeReturnPath(c.req.query('return')), exp: nowSec() + STATE_TTL_SEC };
  c.header('set-cookie', serializeCookie(STATE_COOKIE, await signPayload(payload, cfg.sessionSecret), { maxAgeSec: STATE_TTL_SEC, secure: isHttps(c) }));
  c.header('cache-control', 'no-store');
  return c.redirect(buildAuthUrl({ clientId: cfg.clientId, redirectUri: callbackUrl(c), state, codeChallenge: await pkceChallenge(verifier) }), 302);
});

/** Google から戻る。state を照合 → コードを ID トークンに交換 → 検証 → 許可リスト → セッション Cookie */
authRoutes.get('/callback', async (c) => {
  const { cfg } = googleConfig(c.env);
  if (!cfg) return noGoogle(c);
  const secure = isHttps(c);
  c.header('cache-control', 'no-store');
  c.header('set-cookie', serializeCookie(STATE_COOKIE, '', { maxAgeSec: 0, secure }));
  const st = await verifyPayload<StatePayload>(parseCookies(c.req.header('cookie')).get(STATE_COOKIE), cfg.sessionSecret, 'state');
  const oauthError = c.req.query('error');
  if (oauthError) return authPage(c, 401, 'Google ログインが中断されました', `Google から ${oauthError} が返されました。`);
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!st || !code || !state || state !== st.state) return authPage(c, 400, 'ログインの状態が一致しません', '時間切れ（10 分）か、別のブラウザで開いた可能性があります。もう一度ログインしてください。');
  let identity;
  try {
    const idToken = await exchangeCode({ code, redirectUri: callbackUrl(c), codeVerifier: st.verifier, clientId: cfg.clientId, clientSecret: cfg.clientSecret });
    identity = await verifyGoogleIdToken(idToken, cfg.clientId);
  } catch (e) {
    console.error('Google ログインに失敗', e);
    return authPage(c, 401, 'Google ログインに失敗しました', 'もう一度お試しください。繰り返す場合は管理者に連絡してください。');
  }
  const allowed = parseAllowList(c.env.ALLOWED_EMAILS, c.env.ALLOWED_EMAIL_DOMAINS);
  if (!isEmailAllowed(identity.email, allowed)) return authPage(c, 403, '閲覧できません', `${identity.email} ではこのアプリを閲覧できません。${notAllowedMessage()}`);
  const now = nowSec();
  const sess: SessionPayload = { kind: 'session', email: identity.email, sub: identity.sub, name: identity.name, iat: now, exp: now + cfg.sessionTtlSec };
  c.header('set-cookie', serializeCookie(SESSION_COOKIE, await signPayload(sess, cfg.sessionSecret), { maxAgeSec: cfg.sessionTtlSec, secure }), { append: true });
  return c.redirect(st.returnTo, 302);
});

authRoutes.get('/logout', (c) => {
  c.header('set-cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure: isHttps(c) }));
  c.header('cache-control', 'no-store');
  return c.redirect('/', 302);
});
