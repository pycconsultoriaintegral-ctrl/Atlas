import type { DB } from "../db/database.js";

export const TASK_STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: number;
  title: string;
  notes: string;
  status: TaskStatus;
  due_at: string | null;
  project_id: number | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT t.id, t.title, t.notes, t.status, t.due_at, t.project_id, p.name AS project_name, t.created_at, t.updated_at
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id`;

export class TaskRepo {
  constructor(private db: DB) {}

  create(userId: number, input: { title: string; notes?: string; dueAt?: string | null; projectId?: number | null }): Task {
    const res = this.db
      .prepare("INSERT INTO tasks (user_id, title, notes, due_at, project_id) VALUES (?, ?, ?, ?, ?)")
      .run(userId, input.title.trim(), input.notes?.trim() ?? "", input.dueAt ?? null, input.projectId ?? null);
    return this.get(userId, Number(res.lastInsertRowid))!;
  }

  get(userId: number, id: number): Task | undefined {
    return this.db.prepare(`${SELECT} WHERE t.user_id = ? AND t.id = ?`).get(userId, id) as Task | undefined;
  }

  list(userId: number, opts: { status?: TaskStatus | "open"; projectId?: number; limit?: number } = {}): Task[] {
    const where = ["t.user_id = ?"];
    const params: Array<string | number> = [userId];
    if (opts.status === "open") where.push("t.status IN ('pending','in_progress')");
    else if (opts.status) {
      where.push("t.status = ?");
      params.push(opts.status);
    }
    if (opts.projectId) {
      where.push("t.project_id = ?");
      params.push(opts.projectId);
    }
    params.push(Math.min(opts.limit ?? 200, 500));
    return this.db
      .prepare(
        `${SELECT} WHERE ${where.join(" AND ")}
         ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                  t.due_at IS NULL, t.due_at, t.updated_at DESC LIMIT ?`,
      )
      .all(...params) as unknown as Task[];
  }

  update(
    userId: number,
    id: number,
    patch: { title?: string; notes?: string; status?: TaskStatus; dueAt?: string | null; projectId?: number | null },
  ): Task | undefined {
    const cur = this.get(userId, id);
    if (!cur) return undefined;
    this.db
      .prepare(
        "UPDATE tasks SET title = ?, notes = ?, status = ?, due_at = ?, project_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      )
      .run(
        patch.title?.trim() ?? cur.title,
        patch.notes?.trim() ?? cur.notes,
        patch.status ?? cur.status,
        patch.dueAt === undefined ? cur.due_at : patch.dueAt,
        patch.projectId === undefined ? cur.project_id : patch.projectId,
        id,
        userId,
      );
    return this.get(userId, id);
  }

  remove(userId: number, id: number): boolean {
    return this.db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  }
}
