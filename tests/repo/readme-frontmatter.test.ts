import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 機能ごとのディレクトリには README.md（タグ付きフロントマター）を必ず置く（claude_analysis/00_セマンティックレイヤー/タグ体系.md）。
 * 後から見る人が「どのデータに依存しているか」をたどれるようにするため
 */
const REQUIRED = ['src/app/features/home', 'src/app/features/company', 'src/app/features/targets', 'src/app/features/settings', 'src/app/components/charts', 'src/worker/routes', 'src/worker/sql', 'src/shared', 'd1', 'bq', 'ai', 'ai/report', 'ai/scout', 'ai/job', 'scripts/ai', 'src/worker/ai', 'src/worker/ai/report', 'src/worker/ai/scout', 'src/worker/ai/job', 'src/app/features/ai/common', 'src/app/features/ai/report', 'src/app/features/ai/report/slides', 'src/app/features/ai/report/pdf', 'src/app/features/ai/scout', 'src/app/features/ai/job'];

function martDirs(): string[] {
  const root = join(process.cwd(), 'bq/marts');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => d.startsWith('cms_') && statSync(join(root, d)).isDirectory())
    .map((d) => `bq/marts/${d}`);
}

describe('README のフロントマター', () => {
  for (const dir of [...REQUIRED, ...martDirs()]) {
    it(`${dir}/README.md に tags（layer/・type/）と status がある`, () => {
      const p = join(process.cwd(), dir, 'README.md');
      expect(existsSync(p), `${p} が無い`).toBe(true);
      const text = readFileSync(p, 'utf8');
      expect(text.startsWith('---\n')).toBe(true);
      const fm = text.split('\n---')[0];
      expect(fm).toMatch(/tags:\s*\[/);
      expect(fm).toMatch(/layer\//);
      expect(fm).toMatch(/type\//);
      expect(fm).toMatch(/status:\s*(active|draft|deprecated)/);
      expect(text).toMatch(/依存するデータ|元テーブル|ソース/);
    });
  }
});
