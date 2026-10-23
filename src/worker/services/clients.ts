import { BqError, RestBqClient, type BqClient } from '../bq/client';
import { MockBqClient } from '../bq/mockClient';
import { isMock, type Env } from '../env';

/** BigQuery クライアント。BQ_MOCK=1 ならフィクスチャ、鍵が無ければ noCredentials（画面に設定手順を案内） */
export function makeClient(env: Env): BqClient {
  if (isMock(env)) return new MockBqClient();
  const key = env.BQ_SA_KEY?.trim();
  if (!key) {
    console.error('BQ_SA_KEY が未設定（Cloudflare → Worker → Settings → Variables and Secrets に Secret BQ_SA_KEY を追加して Deploy）');
    throw new BqError(
      'BigQuery の鍵（Secret BQ_SA_KEY）が Worker に届いていません。Cloudflare ダッシュボード → この Worker → Settings → Variables and Secrets で Type: Secret、名前 BQ_SA_KEY を追加し「Deploy」を押してください（ローカルは .dev.vars の BQ_MOCK=1）。',
      'noCredentials',
      500,
    );
  }
  return new RestBqClient({ project: env.BQ_PROJECT, location: env.BQ_LOCATION, saKey: key });
}
