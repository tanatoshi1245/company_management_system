import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { healthRoutes } from './health';
import { meRoutes } from './me';
import { metaRoutes } from './meta';
import { boardRoutes } from './board';
import { companyRoutes } from './companies';

/** /api 配下。認証ミドルウェアは index.ts で先頭に掛けてあるので、ここに来るリクエストはすべてログイン済み */
export const api = new Hono<AppEnv>();
api.route('/', healthRoutes);
api.route('/', meRoutes);
api.route('/', metaRoutes);
api.route('/', boardRoutes);
api.route('/', companyRoutes);
api.all('*', (c) => c.json({ error: 'not found', code: 'notFound' }, 404));
