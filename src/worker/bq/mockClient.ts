import type { BqClient, QueryResult } from './client';
import type { BuiltQuery } from './params';
import { mockRows } from './fixtures';

/** BigQuery を呼ばずフィクスチャ（src/worker/bq/fixtures/）を返すクライアント。ラベルでマートを振り分け、@param で絞る */
export class MockBqClient implements BqClient {
  readonly mock = true;
  async run(q: BuiltQuery): Promise<QueryResult> {
    return { rows: mockRows(q), bytesProcessed: 0, cacheHit: false, jobId: null };
  }
  async dryRun(): Promise<{ bytesProcessed: number }> {
    return { bytesProcessed: 0 };
  }
}
