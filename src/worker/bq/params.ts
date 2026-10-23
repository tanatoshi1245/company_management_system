// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
/** BigQuery REST `queryParameters` のビルダー。利用者入力は必ずここを通し、SQL 本文には埋め込まない。 */
export interface QueryParameter {
  name: string;
  parameterType: { type: string; arrayType?: { type: string } };
  parameterValue: { value?: string | null; arrayValues?: { value: string }[] };
}

export const p = {
  str(name: string, v: string): QueryParameter {
    return { name, parameterType: { type: 'STRING' }, parameterValue: { value: v } };
  },
  int(name: string, v: number): QueryParameter {
    return { name, parameterType: { type: 'INT64' }, parameterValue: { value: String(Math.trunc(v)) } };
  },
  nullableInt(name: string, v: number | null): QueryParameter {
    return { name, parameterType: { type: 'INT64' }, parameterValue: { value: v === null ? null : String(Math.trunc(v)) } };
  },
  bool(name: string, v: boolean): QueryParameter {
    return { name, parameterType: { type: 'BOOL' }, parameterValue: { value: v ? 'true' : 'false' } };
  },
  date(name: string, v: string): QueryParameter {
    return { name, parameterType: { type: 'DATE' }, parameterValue: { value: v } };
  },
  strArray(name: string, vs: string[]): QueryParameter {
    return {
      name,
      parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } },
      parameterValue: { arrayValues: vs.map((v) => ({ value: v })) },
    };
  },
};

export interface BuiltQuery {
  /** ログ・モック振り分け用のラベル */
  label: string;
  sql: string;
  params: QueryParameter[];
}
