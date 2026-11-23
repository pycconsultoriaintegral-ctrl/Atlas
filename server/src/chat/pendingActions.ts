import type { DB } from "../db/database.js";

export type ActionStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

export interface PendingAction {
  id: number;
  conversation_id: number | null;
  tool_name: string;
  input: unknown;
  summary: string;
  status: ActionStatus;
  result: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Las acciones pendientes de confirmación caducan a las 24 h. */
const EXPIRY_HOURS = 24;

/** Acciones sensibles que esperan tu aprobación explícita. */
export class PendingActions {
  constructor(private db: DB) {}

  create(userId: number, conversationId: number | null, toolName: string, input: unknown, summary: string): PendingAction {
    const res = this.db
      .prepare("INSERT INTO pending_actions (user_id, conversation_id, tool_name, input, summary) VALUES (?, ?, ?, ?, ?)")
      .run(userId, conversationId, toolName, JSON.stringify(input), summary);
    return this.get(userId, Number(res.lastInsertRowid))!;
  }

  get(userId: number, id: number): PendingAction | undefined {
    this.expireOld();
    const r = this.db.prepare("SELECT * FROM pending_actions WHERE user_id = ? AND id = ?").get(userId, id) as
      | (Omit<PendingAction, "input"> & { input: string })
      | undefined;
    return r ? { ...r, input: JSON.parse(r.input) } : undefined;
  }

  list(userId: number, status?: ActionStatus): PendingAction[] {
    this.expireOld();
    const rows = (
      status
        ? this.db.prepare("SELECT * FROM pending_actions WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 100").all(userId, status)
        : this.db.prepare("SELECT * FROM pending_actions WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(userId)
    ) as Array<Omit<PendingAction, "input"> & { input: string }>;
    return rows.map((r) => ({ ...r, input: JSON.parse(r.input) }));
  }

  /** Transición atómica: sólo una petición puede decidir sobre una acción pendiente. */
  decide(userId: number, id: number, status: "approved" | "rejected"): boolean {
    this.expireOld();
    return (
      this.db
        .prepare("UPDATE pending_actions SET status = ?, decided_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'pending'")
        .run(status, id, userId).changes > 0
    );
  }

  finish(id: number, status: "executed" | "failed", result: string) {
    this.db.prepare("UPDATE pending_actions SET status = ?, result = ? WHERE id = ?").run(status, result.slice(0, 4000), id);
  }

  rejectAll(userId: number): number {
    return Number(
      this.db
        .prepare("UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE user_id = ? AND status = 'pending'")
        .run(userId).changes,
    );
  }

  private expireOld() {
    this.db
      .prepare(
        `UPDATE pending_actions SET status = 'expired' WHERE status = 'pending' AND created_at < datetime('now', '-${EXPIRY_HOURS} hours')`,
      )
      .run();
  }
}
