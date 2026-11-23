import type { DB } from "../db/database.js";

export const MEMORY_CATEGORIES = ["general", "preferencia", "persona", "proyecto", "trabajo", "personal", "dato"] as const;

export interface Memory {
  id: number;
  content: string;
  category: string;
  project_id: number | null;
  project_name: string | null;
  source: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const MEMORY_SELECT = `SELECT m.id, m.content, m.category, m.project_id, p.name AS project_name, m.source, m.pinned, m.created_at, m.updated_at
  FROM memories m LEFT JOIN projects p ON p.id = m.project_id`;

/** Memoria a largo plazo de ATLAS (compartida entre todos tus dispositivos). */
export class MemoryRepo {
  constructor(private db: DB) {}

  create(userId: number, input: { content: string; category?: string; projectId?: number | null; source?: string; pinned?: boolean }): Memory {
    if (input.projectId != null) this.requireProject(userId, input.projectId);
    const res = this.db
      .prepare("INSERT INTO memories (user_id, content, category, project_id, source, pinned) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, input.content.trim(), input.category || "general", input.projectId ?? null, input.source || "user", input.pinned ? 1 : 0);
    return this.get(userId, Number(res.lastInsertRowid))!;
  }

  get(userId: number, id: number): Memory | undefined {
    return this.db.prepare(`${MEMORY_SELECT} WHERE m.user_id = ? AND m.id = ?`).get(userId, id) as Memory | undefined;
  }

  list(userId: number, opts: { query?: string; category?: string; projectId?: number; limit?: number } = {}): Memory[] {
    const limit = Math.min(opts.limit ?? 200, 500);
    const where: string[] = ["m.user_id = ?"];
    const params: Array<string | number> = [userId];
    if (opts.category) {
      where.push("m.category = ?");
      params.push(opts.category);
    }
    if (opts.projectId) {
      where.push("m.project_id = ?");
      params.push(opts.projectId);
    }
    const fts = opts.query ? toFtsQuery(opts.query) : "";
    if (fts) {
      where.push("m.id IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?)");
      params.push(fts);
    }
    params.push(limit);
    return this.db
      .prepare(`${MEMORY_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.pinned DESC, m.updated_at DESC LIMIT ?`)
      .all(...params) as unknown as Memory[];
  }

  /** Búsqueda por relevancia (para darle contexto a la IA). */
  search(userId: number, query: string, limit = 8): Memory[] {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    return this.db
      .prepare(
        `${MEMORY_SELECT} JOIN memories_fts f ON f.rowid = m.id
         WHERE m.user_id = ? AND memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?`,
      )
      .all(userId, fts, limit) as unknown as Memory[];
  }

  /** Recuerdos fijados y preferencias: siempre se le muestran a ATLAS. */
  essentials(userId: number, limit = 15): Memory[] {
    return this.db
      .prepare(
        `${MEMORY_SELECT} WHERE m.user_id = ? AND (m.pinned = 1 OR m.category = 'preferencia')
         ORDER BY m.pinned DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(userId, limit) as unknown as Memory[];
  }

  update(userId: number, id: number, patch: { content?: string; category?: string; projectId?: number | null; pinned?: boolean }): Memory | undefined {
    const current = this.get(userId, id);
    if (!current) return undefined;
    if (patch.projectId != null) this.requireProject(userId, patch.projectId);
    this.db
      .prepare(
        "UPDATE memories SET content = ?, category = ?, project_id = ?, pinned = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      )
      .run(
        patch.content?.trim() ?? current.content,
        patch.category ?? current.category,
        patch.projectId === undefined ? current.project_id : patch.projectId,
        patch.pinned === undefined ? current.pinned : patch.pinned ? 1 : 0,
        id,
        userId,
      );
    return this.get(userId, id);
  }

  remove(userId: number, id: number): boolean {
    return this.db.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  }

  // ── Proyectos ──────────────────────────────────────────────

  createProject(userId: number, input: { name: string; description?: string }): Project {
    const res = this.db
      .prepare("INSERT INTO projects (user_id, name, description) VALUES (?, ?, ?)")
      .run(userId, input.name.trim(), input.description?.trim() ?? "");
    return this.getProject(userId, Number(res.lastInsertRowid))!;
  }

  getProject(userId: number, id: number): Project | undefined {
    return this.db
      .prepare("SELECT id, name, description, status, created_at, updated_at FROM projects WHERE user_id = ? AND id = ?")
      .get(userId, id) as Project | undefined;
  }

  findProjectByName(userId: number, name: string): Project | undefined {
    return this.db
      .prepare("SELECT id, name, description, status, created_at, updated_at FROM projects WHERE user_id = ? AND name = ? COLLATE NOCASE")
      .get(userId, name.trim()) as Project | undefined;
  }

  listProjects(userId: number, includeArchived = false): Project[] {
    return this.db
      .prepare(
        `SELECT id, name, description, status, created_at, updated_at FROM projects WHERE user_id = ? ${includeArchived ? "" : "AND status = 'active'"} ORDER BY updated_at DESC`,
      )
      .all(userId) as unknown as Project[];
  }

  updateProject(userId: number, id: number, patch: { name?: string; description?: string; status?: "active" | "archived" }): Project | undefined {
    const cur = this.getProject(userId, id);
    if (!cur) return undefined;
    this.db
      .prepare("UPDATE projects SET name = ?, description = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(patch.name?.trim() ?? cur.name, patch.description?.trim() ?? cur.description, patch.status ?? cur.status, id, userId);
    return this.getProject(userId, id);
  }

  removeProject(userId: number, id: number): boolean {
    return this.db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  }

  private requireProject(userId: number, id: number) {
    if (!this.getProject(userId, id)) throw new Error(`El proyecto #${id} no existe.`);
  }
}

/** Convierte texto libre en una consulta FTS5 segura (palabras con OR). */
export function toFtsQuery(text: string): string {
  const words = (text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .slice(0, 12);
  return [...new Set(words)].map((w) => `"${w}"*`).join(" OR ");
}

const STOPWORDS = new Set(
  "que los las del por para con una uno unos unas como más pero sus este esta esto ese esa eso hay muy sin sobre también fue han ser son está están tiene tengo puedes puede quiero hola atlas qué cómo cuál cuando dónde the and for with you are this that".split(
    " ",
  ),
);
