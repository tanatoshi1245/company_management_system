import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { healthRoutes } from './health';
import { meRoutes } from './me';
import { metaRoutes } from './meta';
import { boardRoutes } from './board';
import { companyRoutes } from './companies';
import { targetRoutes } from './targets';
import { settingsRoutes } from './settings';
import { adminRoutes } from './admin';
import { scoutUnusedRoutes } from './scoutUnused';

/** /api 配下。認証ミドルウェアは index.ts で先頭に掛けてあるので、ここに来るリクエストはすべてログイン済み */
export const api = new Hono<AppEnv>();
api.route('/', healthRoutes);
api.route('/', meRoutes);
api.route('/', metaRoutes);
api.route('/', boardRoutes);
api.route('/', companyRoutes);
api.route('/', targetRoutes);
api.route('/', settingsRoutes);
api.route('/', scoutUnusedRoutes);
api.route('/', adminRoutes);
api.all('*', (c) => c.json({ error: 'not found', code: 'notFound' }, 404));
