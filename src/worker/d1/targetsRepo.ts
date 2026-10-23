import type { D1Like, D1StmtLike } from './db';
import { EMPTY_TARGETS, STAGE_TARGET_KEYS, type TargetRecord, type TargetValues } from '../../shared/schema/targets';

export interface TargetRow {
  company_id: number;
  target_month: string;
  scout_sent_target: number | null;
  application_target: number | null;
  interested_target: number | null;
  view_target: number | null;
  hire_target: number | null;
  stage_targets_json: string;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export function rowToValues(r: TargetRow): TargetValues {
  let stages: TargetValues['stages'] = {};
  try {
    const parsed = JSON.parse(r.stage_targets_json || '{}') as Record<string, unknown>;
    for (const k of STAGE_TARGET_KEYS) {
      const v = parsed[k];
      if (typeof v === 'number') stages = { ...stages, [k]: v };
    }
  } catch {
    stages = {};
  }
  return { ...EMPTY_TARGETS, scout_sent: r.scout_sent_target, applications: r.application_target, interested: r.interested_target, views: r.view_target, hires: r.hire_target, stages };
}

export function rowToRecord(r: TargetRow): TargetRecord {
  return { companyId: String(r.company_id), month: r.target_month, values: rowToValues(r), note: r.note, createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at };
}

/** stages は許可キーだけを数値で残して再シリアライズ（任意の JSON を保存しない） */
export function stagesJson(stages: TargetValues['stages'] | undefined): string {
  const out: Record<string, number> = {};
  for (const k of STAGE_TARGET_KEYS) {
    const v = stages?.[k];
    if (typeof v === 'number') out[k] = v;
  }
  return JSON.stringify(out);
}

const COLS = 'company_id, target_month, scout_sent_target, application_target, interested_target, view_target, hire_target, stage_targets_json, note, created_by, created_at, updated_by, updated_at';

/** company_targets。すべて prepare().bind()。書き込みは Stmt を返し、呼び出し側が監査ログと同じ batch() に入れる */
export class TargetsRepo {
  constructor(private readonly db: D1Like) {}

  async byMonth(month: string): Promise<Map<string, TargetRow>> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM company_targets WHERE target_month = ?1`).bind(month).all<TargetRow>();
    return new Map(results.map((r) => [String(r.company_id), r]));
  }

  async byCompany(companyId: string, from: string, to: string): Promise<TargetRow[]> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM company_targets WHERE company_id = ?1 AND target_month BETWEEN ?2 AND ?3 ORDER BY target_month`).bind(Number(companyId), from, to).all<TargetRow>();
    return results;
  }

  async get(companyId: string, month: string): Promise<TargetRow | null> {
    return this.db.prepare(`SELECT ${COLS} FROM company_targets WHERE company_id = ?1 AND target_month = ?2`).bind(Number(companyId), month).first<TargetRow>();
  }

  /** 指定月のうち、既に目標がある (company_id, month) の集合 */
  async existing(months: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const m of months) {
      const { results } = await this.db.prepare('SELECT company_id, target_month FROM company_targets WHERE target_month = ?1').bind(m).all<{ company_id: number; target_month: string }>();
      for (const r of results) out.add(`${r.company_id}|${r.target_month}`);
    }
    return out;
  }

  upsertStmt(companyId: string, month: string, v: TargetValues, note: string | null, actor: string, nowIso: string): D1StmtLike {
    return this.db
      .prepare(
        `INSERT INTO company_targets (company_id, target_month, scout_sent_target, application_target, interested_target, view_target, hire_target, stage_targets_json, note, created_by, created_at, updated_by, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10, ?11)
         ON CONFLICT(company_id, target_month) DO UPDATE SET
           scout_sent_target = excluded.scout_sent_target, application_target = excluded.application_target, interested_target = excluded.interested_target,
           view_target = excluded.view_target, hire_target = excluded.hire_target, stage_targets_json = excluded.stage_targets_json, note = excluded.note,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .bind(Number(companyId), month, v.scout_sent, v.applications, v.interested, v.views, v.hires, stagesJson(v.stages), note, actor, nowIso);
  }

  deleteStmt(companyId: string, month: string): D1StmtLike {
    return this.db.prepare('DELETE FROM company_targets WHERE company_id = ?1 AND target_month = ?2').bind(Number(companyId), month);
  }
}
