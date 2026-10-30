// 複製元: sales_dashboard_IS-FS_ver2 の src/worker/bq/client.ts。変更点: labels.app、既定の fetchImpl を safeFetch（許可ホストのみ）に、maximumBytesBilled の既定を 200 MB に。
import { getAccessToken, parseServiceAccountKey, type ServiceAccountKey } from './auth';
import type { BuiltQuery } from './params';
import { parseRows, type BqQueryResponse, type Row } from './parseRows';
import { safeFetch } from '../lib/safeFetch';

export interface QueryResult {
  rows: Row[];
  bytesProcessed: number;
  cacheHit: boolean;
  jobId: string | null;
}

export interface BqClient {
  run(q: BuiltQuery): Promise<QueryResult>;
  dryRun(q: BuiltQuery): Promise<{ bytesProcessed: number }>;
  readonly mock: boolean;
}

export interface RestClientOptions {
  project: string;
  location: string;
  saKey: string;
  timeoutMs?: number;
  maxPolls?: number;
  maximumBytesBilled?: number;
  fetchImpl?: typeof fetch;
}

export class BqError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/** リクエスト時に許すスキャン量の上限。マートは小さいので 200 MB を超えたら設計ミス（生テーブルを読んでいる） */
export const DEFAULT_MAX_BYTES = 200 * 1024 ** 2;

/** BigQuery REST `jobs.query` を使うクライアント（同期実行 → 未完なら getQueryResults をポーリング） */
export class RestBqClient implements BqClient {
  readonly mock = false;
  private readonly sa: ServiceAccountKey;
  private readonly timeoutMs: number;
  private readonly maxPolls: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: RestClientOptions) {
    this.sa = parseServiceAccountKey(opts.saKey);
    this.timeoutMs = opts.timeoutMs ?? 25000;
    this.maxPolls = opts.maxPolls ?? 6;
    this.maxBytes = opts.maximumBytesBilled ?? DEFAULT_MAX_BYTES;
    // グローバル fetch をそのまま保持すると this が RestBqClient に束縛され Workers が "Illegal invocation" を投げる。
    // safeFetch は内部で globalThis.fetch を呼ぶので安全（さらに宛先を許可リストで固定する）
    this.fetchImpl = opts.fetchImpl ?? safeFetch;
  }

  private base(): string {
    return `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.opts.project)}`;
  }

  private async call(path: string, init: RequestInit): Promise<BqQueryResponse> {
    const token = await getAccessToken(this.sa, this.fetchImpl);
    const res = await this.fetchImpl(`${this.base()}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const json = (await res.json().catch(() => ({}))) as BqQueryResponse;
    if (!res.ok) {
      const reason = json.error?.errors?.[0]?.reason ?? 'unknown';
      throw new BqError(json.error?.message ?? `BigQuery API error ${res.status}`, reason, res.status);
    }
    if (json.errors && json.errors.length > 0) {
      throw new BqError(json.errors[0].message ?? 'BigQuery job error', json.errors[0].reason ?? 'jobError');
    }
    return json;
  }

  private body(q: BuiltQuery, dryRun: boolean): Record<string, unknown> {
    return {
      query: q.sql,
      useLegacySql: false,
      parameterMode: 'NAMED',
      queryParameters: q.params,
      location: this.opts.location,
      timeoutMs: this.timeoutMs,
      maxResults: 5000,
      maximumBytesBilled: String(q.maxBytes ?? this.maxBytes),
      useQueryCache: true,
      labels: { app: 'company-management-system', q: q.label.toLowerCase().replace(/[^a-z0-9_-]/g, '_') },
      dryRun,
    };
  }

  async dryRun(q: BuiltQuery): Promise<{ bytesProcessed: number }> {
    const json = await this.call('/queries', { method: 'POST', body: JSON.stringify(this.body(q, true)) });
    return { bytesProcessed: Number(json.totalBytesProcessed ?? 0) };
  }

  async run(q: BuiltQuery): Promise<QueryResult> {
    let json = await this.call('/queries', { method: 'POST', body: JSON.stringify(this.body(q, false)) });
    const jobId = json.jobReference?.jobId ?? null;
    const loc = json.jobReference?.location ?? this.opts.location;
    let polls = 0;
    while (json.jobComplete === false) {
      if (!jobId) throw new BqError('jobId が返らず結果を取得できません', 'noJobId');
      if (polls++ >= this.maxPolls) throw new BqError('BigQuery クエリがタイムアウトしました', 'timeout');
      json = await this.call(
        `/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(loc)}&timeoutMs=${this.timeoutMs}&maxResults=5000`,
        { method: 'GET' },
      );
    }
    const rows: Row[] = parseRows(json);
    let pageToken = json.pageToken;
    let pages = 0;
    while (pageToken && jobId && pages++ < 100) {
      const next = await this.call(
        `/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(loc)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=5000`,
        { method: 'GET' },
      );
      rows.push(...parseRows({ ...next, schema: next.schema ?? json.schema }));
      pageToken = next.pageToken;
    }
    return {
      rows,
      bytesProcessed: Number(json.totalBytesProcessed ?? 0),
      cacheHit: Boolean(json.cacheHit),
      jobId,
    };
  }
}
