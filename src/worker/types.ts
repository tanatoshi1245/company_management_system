import type { Context } from 'hono';
import type { Env } from './env';
import type { Identity } from './auth/middleware';

export type AuthMode = 'google' | 'mock' | 'none';
export type Variables = { identity: Identity | null; authMode: AuthMode; requestId: string };
export type AppEnv = { Bindings: Env; Variables: Variables };
export type Ctx = Context<AppEnv>;
