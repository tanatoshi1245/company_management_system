// 複製元: sales_dashboard_IS-FS_ver2 の src/worker/index.ts の骨格。変更点: 認証を auth/middleware.ts に分離（fail-closed）、/auth と /api をサブアプリに、セキュリティヘッダ・CSRF・リクエストログを追加。
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { securityHeaders } from './lib/securityHeaders';
import { authenticate } from './auth/middleware';
import { sameOriginGuard } from './auth/csrf';
import { requestLog } from './lib/log';
import { authRoutes } from './auth/routes';
import { api } from './routes';
import { errorResponse } from './lib/errors';

const app = new Hono<AppEnv>();

// 順序が大事: ヘッダ → 認証（全パス）→ CSRF（書き込み）→ ログ → ルート
app.use('*', securityHeaders);
app.use('*', authenticate);
app.use('/api/*', sameOriginGuard);
app.use('/api/*', requestLog);
app.route('/auth', authRoutes);
app.route('/api', api);
app.onError(errorResponse);
// それ以外は静的アセット（SPA）
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
