import type { BqClient } from '../bq/client';
import type { D1Like } from '../d1/db';
import { nowIso } from '../d1/db';
import { ScoutUnusedRepo, type ScoutUnusedRow } from '../d1/scoutUnusedRepo';
import { scoutUnusedMergeQuery } from '../sql/scoutUnused';
import type { ScoutUnusedRow as DetailRow } from '../../shared/schema/company';
import { parseScoutUnused } from './companyService';

/** D1 の 1 行を BigQuery（scout_unused_companies_monthly の match_method = 'app' の行）に写す。成功で bq_synced_at、失敗で bq_error。モックは常に成功 */
export async function syncOne(client: BqClient, db: D1Like, row: ScoutUnusedRow, display: { salesRep: string | null; companyName: string | null }): Promise<{ synced: boolean; error: string | null }> {
  const repo = new ScoutUnusedRepo(db);
  try {
    if (!client.mock) {
      await client.run(scoutUnusedMergeQuery({ companyId: String(row.company_id), month: row.target_month, reason: row.reason, remarks: row.remarks, salesRep: display.salesRep, companyName: display.companyName, updatedBy: row.updated_by, deleted: row.deleted_at !== null }));
    }
    await repo.markSynced(String(row.company_id), row.target_month, nowIso());
    return { synced: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await repo.markError(String(row.company_id), row.target_month, msg);
    return { synced: false, error: msg };
  }
}

/** 企業ページ用: マートの記録（シート + アプリ、翌朝更新）に D1 の最新を重ねる。同じ月は D1（アプリ）が勝つ */
export function overlayScoutUnused(martJson: unknown, d1Rows: ScoutUnusedRow[]): DetailRow[] {
  const mart = parseScoutUnused(martJson);
  const app = new Map(d1Rows.filter((r) => r.deleted_at === null).map((r) => [r.target_month, r]));
  const deleted = new Set(d1Rows.filter((r) => r.deleted_at !== null).map((r) => r.target_month));
  const out: DetailRow[] = [];
  const seen = new Set<string>();
  for (const [month, r] of app) {
    out.push({ month, reason: r.reason, remarks: r.remarks, source: 'app' });
    seen.add(month);
  }
  for (const m of mart) {
    if (seen.has(m.month)) continue;
    // アプリで削除した月は、マートに残っている古いアプリの行を出さない（シートの行は残す）
    if (m.source === 'app' && deleted.has(m.month)) continue;
    out.push(m);
    seen.add(m.month);
  }
  return out.sort((a, b) => b.month.localeCompare(a.month));
}
