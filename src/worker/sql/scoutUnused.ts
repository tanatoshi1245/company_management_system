import { p, type BuiltQuery } from '../bq/params';

export interface ScoutUnusedMergeInput {
  companyId: string;
  /** YYYY-MM */
  month: string;
  reason: string | null;
  remarks: string | null;
  salesRep: string | null;
  companyName: string | null;
  updatedBy: string;
  deleted: boolean;
}

/**
 * アプリの登録を既存の dwh.scout_unused_companies_monthly（シート取込と同じ表）に match_method = 'app' の行として写す。
 * 企業 × 月で 1 行（target_month はシートと同じ月末日）。削除は行を消す。シート取込の行（match_method = summary 等）には触らない。値はすべて @param
 */
export function scoutUnusedMergeQuery(i: ScoutUnusedMergeInput): BuiltQuery {
  return {
    label: 'scout_unused_merge',
    sql: `
MERGE \`bq-hgt.dwh.scout_unused_companies_monthly\` T
USING (SELECT @id AS company_id, LAST_DAY(DATE(@month)) AS target_month) S
ON T.company_id = S.company_id AND T.target_month = S.target_month AND T.match_method = 'app'
WHEN MATCHED AND @deleted THEN DELETE
WHEN MATCHED THEN UPDATE SET
  unused_reason = @reason, remarks = @remarks, sales_rep = @salesRep, company_name = @companyName, loaded_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED AND NOT @deleted THEN INSERT (target_month, profile_id, company_id, company_name, profile_name_ja, sales_rep, unused_reason, remarks, match_method, loaded_at)
  VALUES (LAST_DAY(DATE(@month)), NULL, @id, @companyName, NULL, @salesRep, @reason, @remarks, 'app', CURRENT_TIMESTAMP())`,
    params: [
      p.int('id', Number(i.companyId)),
      p.str('month', `${i.month}-01`),
      p.nullableStr('reason', i.reason),
      p.nullableStr('remarks', i.remarks),
      p.nullableStr('salesRep', i.salesRep),
      p.nullableStr('companyName', i.companyName),
      p.bool('deleted', i.deleted),
    ],
  };
}

/** マートの scout_unused_json からその月の記録を持つ企業（シート取込の参考表示用） */
export function scoutUnusedByMonthQuery(month: string): BuiltQuery {
  return {
    label: 'scout_unused_by_month',
    sql: `
SELECT CAST(company_id AS STRING) AS company_id, scout_unused_json
FROM \`bq-hgt.dwh.cms_company_master\`
WHERE scout_unused_json LIKE CONCAT('%"month":"', @month, '"%')`,
    params: [p.str('month', month)],
  };
}
