import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** テスト環境（docs/テスト環境.md）の設定が、本番と混ざらないこと */
describe('テスト環境の設定', () => {
  const raw = readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const cfg = JSON.parse(raw) as { name: string; d1_databases: { database_name: string; database_id?: string }[]; env: { staging: { name: string; vars: Record<string, string>; d1_databases: { binding: string; database_name: string; database_id?: string }[] } } };

  it('別名の Worker・別の D1・APP_ENV = staging。本番の D1 を指さない', () => {
    const stg = cfg.env.staging;
    expect(cfg.name).toBe('company-management-system');
    expect(stg.name).toBe('company-management-system-staging');
    expect(stg.vars).toMatchObject({ APP_ENV: 'staging', ALLOWED_EMAIL_DOMAINS: 'daijob.com,athuman.com' });
    expect(stg.d1_databases).toHaveLength(1);
    expect(stg.d1_databases[0].binding).toBe('CMS_DB');
    expect(stg.d1_databases[0].database_name).toBe('company-management-system-staging');
    expect(stg.d1_databases[0].database_id).not.toBe(cfg.d1_databases[0].database_id);
  });

  it('Secret（鍵・発火のトークン）を設定ファイルに書かない', () => {
    expect(raw).not.toMatch(/AI_ROUTINE_TOKEN|AI_ROUTINE_ID|BQ_SA_KEY"\s*:|sk-ant-|private_key/);
  });
});
