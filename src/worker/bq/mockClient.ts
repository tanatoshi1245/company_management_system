import type { BqClient, QueryResult } from './client';
import type { BuiltQuery } from './params';
import { mockRows } from './fixtures';

/** BigQuery を呼ばずフィクスチャ（src/worker/bq/fixtures/）を返すクライアント。ラベルでマートを振り分け、@param で絞る。書き込み（MERGE）のラベルは何もせず 0 行を返す（AI のマート cms_ai_* のフィクスチャは fixtures/aiScout.ts） */
export class MockBqClient implements BqClient {
  readonly mock = true;
  async run(q: BuiltQuery): Promise<QueryResult> {
    return { rows: mockRows(q), bytesProcessed: 0, cacheHit: false, jobId: null };
  }
  async dryRun(): Promise<{ bytesProcessed: number }> {
    return { bytesProcessed: 0 };
  }
}
