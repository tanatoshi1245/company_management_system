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

/** アプリの登録を dwh.cms_scout_unused_app に写す（企業 × 月で 1 行。削除は deleted = TRUE）。値はすべて @param */
export function scoutUnusedMergeQuery(i: ScoutUnusedMergeInput): BuiltQuery {
  return {
    label: 'scout_unused_merge',
    sql: `
MERGE \`bq-hgt.dwh.cms_scout_unused_app\` T
USING (SELECT @id AS company_id, DATE(@month) AS target_month) S
ON T.company_id = S.company_id AND T.target_month = S.target_month
WHEN MATCHED THEN UPDATE SET
  unused_reason = @reason, remarks = @remarks, sales_rep = @salesRep, company_name = @companyName,
  updated_by = @updatedBy, updated_at = CURRENT_TIMESTAMP(), deleted = @deleted
WHEN NOT MATCHED THEN INSERT (company_id, target_month, unused_reason, remarks, sales_rep, company_name, updated_by, updated_at, deleted)
  VALUES (@id, DATE(@month), @reason, @remarks, @salesRep, @companyName, @updatedBy, CURRENT_TIMESTAMP(), @deleted)`,
    params: [
      p.int('id', Number(i.companyId)),
      p.str('month', `${i.month}-01`),
      p.nullableStr('reason', i.reason),
      p.nullableStr('remarks', i.remarks),
      p.nullableStr('salesRep', i.salesRep),
      p.nullableStr('companyName', i.companyName),
      p.str('updatedBy', i.updatedBy),
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
