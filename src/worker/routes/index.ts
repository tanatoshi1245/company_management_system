import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { healthRoutes } from './health';
import { meRoutes } from './me';
import { metaRoutes } from './meta';

/** /api 配下。認証ミドルウェアは index.ts で先頭に掛けてあるので、ここに来るリクエストはすべてログイン済み */
export const api = new Hono<AppEnv>();
api.route('/', healthRoutes);
api.route('/', meRoutes);
api.route('/', metaRoutes);
api.all('*', (c) => c.json({ error: 'not found', code: 'notFound' }, 404));
