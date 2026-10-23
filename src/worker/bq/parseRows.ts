// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
export interface BqSchemaField {
  name: string;
  type: string;
  mode?: string;
}
export interface BqQueryResponse {
  kind?: string;
  schema?: { fields: BqSchemaField[] };
  jobReference?: { projectId: string; jobId: string; location?: string };
  totalRows?: string;
  pageToken?: string;
  rows?: { f: { v: unknown }[] }[];
  totalBytesProcessed?: string;
  jobComplete?: boolean;
  cacheHit?: boolean;
  errors?: { reason?: string; message?: string }[];
  error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[] };
}

export type Row = Record<string, string | number | boolean | null>;

/** BigQuery の `schema.fields` と `rows[].f[].v` を突き合わせてオブジェクト配列にする */
export function parseRows(resp: BqQueryResponse): Row[] {
  const fields = resp.schema?.fields ?? [];
  const rows = resp.rows ?? [];
  return rows.map((r) => {
    const out: Row = {};
    fields.forEach((f, i) => {
      const raw = r.f[i]?.v;
      out[f.name] = convert(raw, f.type);
    });
    return out;
  });
}

function convert(v: unknown, type: string): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'INTEGER':
    case 'INT64':
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC':
      return Number(v);
    case 'BOOLEAN':
    case 'BOOL':
      return v === 'true' || v === true;
    default:
      return String(v);
  }
}

/** 長形式 (period_key, metric, value) → { [period_key]: { [metric]: value } } */
export function pivotLong(rows: Row[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const k = String(r.period_key ?? '');
    const m = String(r.metric ?? '');
    const v = Number(r.value ?? 0);
    (out[k] ??= {})[m] = v;
  }
  return out;
}
