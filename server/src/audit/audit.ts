import type { DB } from "../db/database.js";
import { redactSecrets } from "../security/redact.js";

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  ip: string | null;
}

/**
 * Registro de operaciones (auditoría). Todo lo importante queda anotado:
 * inicios de sesión, herramientas ejecutadas, aprobaciones, paradas de emergencia…
 * Los secretos se ocultan antes de guardarse.
 */
export class AuditLog {
  constructor(private db: DB) {}

  record(userId: number | null, actor: string, action: string, detail: Record<string, unknown> = {}, ip?: string) {
    const safe = redactSecrets(detail);
    this.db
      .prepare("INSERT INTO audit_log (user_id, actor, action, detail, ip) VALUES (?, ?, ?, ?, ?)")
      .run(userId, actor, action, JSON.stringify(safe).slice(0, 4000), ip ?? null);
  }

  list(userId: number, limit = 100, before?: number): AuditEntry[] {
    const rows = (
      before
        ? this.db
            .prepare("SELECT * FROM audit_log WHERE (user_id = ? OR user_id IS NULL) AND id < ? ORDER BY id DESC LIMIT ?")
            .all(userId, before, limit)
        : this.db
            .prepare("SELECT * FROM audit_log WHERE (user_id = ? OR user_id IS NULL) ORDER BY id DESC LIMIT ?")
            .all(userId, limit)
    ) as Array<{ id: number; ts: string; actor: string; action: string; detail: string; ip: string | null }>;
    return rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
  }
}
