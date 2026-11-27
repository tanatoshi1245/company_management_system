// 複製元: sales_dashboard_IS-FS_ver2 の src/worker/index.ts の骨格。変更点: 認証を auth/middleware.ts に分離（fail-closed）、/auth と /api をサブアプリに、セキュリティヘッダ・CSRF・リクエストログを追加。
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { securityHeaders } from './lib/securityHeaders';
import { authenticate } from './auth/middleware';
import { sameOriginGuard } from './auth/csrf';
import { requestLog } from './lib/log';
import { authRoutes } from './auth/routes';
import { api } from './routes';
import type { Env } from './env';
import { makeScoutDataSource } from './ai/scout/bqDataSource';
import { scheduledScoutTuning } from './ai/scout/service';
import { errorResponse } from './lib/errors';
import { aiEnabled } from './ai/enabled';

const app = new Hono<AppEnv>();

// 順序が大事: ヘッダ → 認証（全パス）→ CSRF（書き込み）→ ログ → ルート
app.use('*', securityHeaders);
app.use('*', authenticate);
app.use('/api/*', sameOriginGuard);
app.use('/api/*', requestLog);
app.route('/auth', authRoutes);
app.route('/api', api);
// 以前の AI 機能のセッション用の入口（/hook/ai/*）は無くした。ログインの外の入口は /auth/ だけ。/hook/ は、ログイン済みでも 404（静的アセットへ落とさない）
app.all('/hook/*', (c) => c.json({ error: 'not found', code: 'notFound' }, 404));
app.onError(errorResponse);
// それ以外は静的アセット（SPA）
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

/**
 * fetch = 画面と API、scheduled = 週次の cron（wrangler.jsonc の triggers。月曜 05:00 JST）: ② スカウトのモデルの検証・チューニング（docs/AI機能.md）。
 * app.fetch / app.request は、テストがそのまま呼べるように残す
 */
export default {
  fetch: app.fetch,
  request: app.request,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    // 停止スイッチ（ai/enabled.ts）: 停止中は何もしない
    if (!aiEnabled(env)) return;
    ctx.waitUntil(scheduledScoutTuning(env, makeScoutDataSource));
  },
};
