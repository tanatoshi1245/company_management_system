import type { D1Like, D1StmtLike } from './db';
import { PLAN_DEFAULT_METRICS, type PlanDefaultMetric, type PlanDefaultValues } from '../../shared/schema/targets';

interface PlanDefaultRow {
  plan: string;
  metric: PlanDefaultMetric;
  value: number;
  updated_at: string;
}

/** plan_target_defaults（プラン × 指標 の縦持ち） */
export class PlanDefaultsRepo {
  constructor(private readonly db: D1Like) {}

  async all(): Promise<{ plans: Record<string, PlanDefaultValues>; updatedAt: string | null }> {
    const { results } = await this.db.prepare('SELECT plan, metric, value, updated_at FROM plan_target_defaults ORDER BY plan, metric LIMIT 2000').all<PlanDefaultRow>();
    const plans: Record<string, PlanDefaultValues> = {};
    let updatedAt: string | null = null;
    for (const r of results) {
      if (!(PLAN_DEFAULT_METRICS as readonly string[]).includes(r.metric)) continue;
      plans[r.plan] = { ...(plans[r.plan] ?? {}), [r.metric]: Number(r.value) };
      if (!updatedAt || r.updated_at > updatedAt) updatedAt = r.updated_at;
    }
    return { plans, updatedAt };
  }

  async byPlan(plan: string): Promise<PlanDefaultValues> {
    const { results } = await this.db.prepare('SELECT plan, metric, value, updated_at FROM plan_target_defaults WHERE plan = ?1').bind(plan).all<PlanDefaultRow>();
    const out: PlanDefaultValues = {};
    for (const r of results) if ((PLAN_DEFAULT_METRICS as readonly string[]).includes(r.metric)) out[r.metric] = Number(r.value);
    return out;
  }

  /** プランの既定値を置き換える: null / 未指定の指標は削除、数値は upsert */
  replaceStmts(plan: string, v: PlanDefaultValues, actor: string, nowIso: string): D1StmtLike[] {
    const stmts: D1StmtLike[] = [this.db.prepare('DELETE FROM plan_target_defaults WHERE plan = ?1').bind(plan)];
    for (const m of PLAN_DEFAULT_METRICS) {
      const val = v[m];
      if (typeof val === 'number') stmts.push(this.db.prepare('INSERT INTO plan_target_defaults (plan, metric, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(plan, m, val, actor, nowIso));
    }
    return stmts;
  }
}
