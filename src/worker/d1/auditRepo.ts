import type { D1Like, D1StmtLike } from './db';
import type { AuditEntry } from '../../shared/schema/targets';

export type AuditEntity = 'company_targets' | 'company_settings' | 'plan_target_defaults' | 'app_meta' | 'scout_unused_entries';

export interface AuditInput {
  at: string;
  actor: string;
  action: 'create' | 'update' | 'delete';
  entity: AuditEntity;
  entityId: string;
  companyId: number | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
}

interface AuditRow {
  id: number;
  at: string;
  actor_email: string;
  action: 'create' | 'update' | 'delete';
  entity: string;
  entity_id: string;
  company_id: number | null;
  before_json: string | null;
  after_json: string | null;
}

const COLS = 'id, at, actor_email, action, entity, entity_id, company_id, before_json, after_json';
const MAX_LIMIT = 200;

function parse(s: string | null): unknown {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function toAuditEntry(r: AuditRow): AuditEntry {
  return { id: Number(r.id), at: r.at, actor: r.actor_email, action: r.action, entity: r.entity, entityId: r.entity_id, companyId: r.company_id === null ? null : String(r.company_id), before: parse(r.before_json), after: parse(r.after_json) };
}

/** 監査ログ。書き込みは必ず本体の更新と同じ batch() に入れる（原子性） */
export class AuditRepo {
  constructor(private readonly db: D1Like) {}

  insertStmt(a: AuditInput): D1StmtLike {
    return this.db
      .prepare('INSERT INTO audit_log (at, actor_email, action, entity, entity_id, company_id, before_json, after_json, request_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
      .bind(a.at, a.actor, a.action, a.entity, a.entityId, a.companyId, a.before === null ? null : JSON.stringify(a.before), a.after === null ? null : JSON.stringify(a.after), a.requestId);
  }

  async byCompany(companyId: string, limit = 50): Promise<AuditEntry[]> {
    const n = Math.min(Math.max(1, limit), MAX_LIMIT);
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM audit_log WHERE company_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2`).bind(Number(companyId), n).all<AuditRow>();
    return results.map(toAuditEntry);
  }

  async byEntity(entity: AuditEntity, limit = 50): Promise<AuditEntry[]> {
    const n = Math.min(Math.max(1, limit), MAX_LIMIT);
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM audit_log WHERE entity = ?1 ORDER BY at DESC, id DESC LIMIT ?2`).bind(entity, n).all<AuditRow>();
    return results.map(toAuditEntry);
  }
}
