import type { DB } from "../db/database.js";
import type { ApiMessage } from "../ai/types.js";

export interface Conversation {
  id: number;
  title: string;
  project_id: number | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
  preview?: string;
}

export interface StoredMessage {
  id: number;
  role: "user" | "assistant" | "system";
  kind: string;
  api_content: unknown;
  display_text: string;
  meta: Record<string, unknown>;
  created_at: string;
}

/** Tipos de mensaje que se muestran en la interfaz. */
const VISIBLE_KINDS = ["chat", "action_decision", "notice"];

export class ConversationRepo {
  constructor(private db: DB) {}

  create(userId: number, input: { title?: string; projectId?: number | null; systemPrompt: string; toolsJson: string }): Conversation {
    const res = this.db
      .prepare("INSERT INTO conversations (user_id, title, project_id, system_prompt, tools_signature) VALUES (?, ?, ?, ?, ?)")
      .run(userId, input.title?.trim() || "Nueva conversación", input.projectId ?? null, input.systemPrompt, input.toolsJson);
    return this.get(userId, Number(res.lastInsertRowid))!;
  }

  get(userId: number, id: number): Conversation | undefined {
    return this.db
      .prepare(
        `SELECT c.id, c.title, c.project_id, p.name AS project_name, c.created_at, c.updated_at
         FROM conversations c LEFT JOIN projects p ON p.id = c.project_id WHERE c.user_id = ? AND c.id = ?`,
      )
      .get(userId, id) as Conversation | undefined;
  }

  /** Instrucciones de sistema y herramientas congeladas al crear la conversación. */
  frozen(userId: number, id: number): { systemPrompt: string; toolsJson: string } | undefined {
    const r = this.db
      .prepare("SELECT system_prompt, tools_signature FROM conversations WHERE user_id = ? AND id = ?")
      .get(userId, id) as { system_prompt: string; tools_signature: string } | undefined;
    return r ? { systemPrompt: r.system_prompt, toolsJson: r.tools_signature } : undefined;
  }

  list(userId: number, opts: { query?: string; projectId?: number; limit?: number } = {}): Conversation[] {
    const where = ["c.user_id = ?"];
    const params: Array<string | number> = [userId];
    if (opts.projectId) {
      where.push("c.project_id = ?");
      params.push(opts.projectId);
    }
    if (opts.query?.trim()) {
      const like = `%${escapeLike(opts.query.trim())}%`;
      where.push(
        "(c.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.display_text LIKE ? ESCAPE '\\'))",
      );
      params.push(like, like);
    }
    params.push(Math.min(opts.limit ?? 100, 300));
    return this.db
      .prepare(
        `SELECT c.id, c.title, c.project_id, p.name AS project_name, c.created_at, c.updated_at,
           (SELECT substr(m.display_text, 1, 140) FROM messages m
            WHERE m.conversation_id = c.id AND m.role = 'assistant' AND m.display_text != '' ORDER BY m.id DESC LIMIT 1) AS preview
         FROM conversations c LEFT JOIN projects p ON p.id = c.project_id
         WHERE ${where.join(" AND ")} ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(...params) as unknown as Conversation[];
  }

  update(userId: number, id: number, patch: { title?: string; projectId?: number | null }): Conversation | undefined {
    const cur = this.get(userId, id);
    if (!cur) return undefined;
    this.db
      .prepare("UPDATE conversations SET title = ?, project_id = ? WHERE id = ? AND user_id = ?")
      .run(patch.title?.trim() || cur.title, patch.projectId === undefined ? cur.project_id : patch.projectId, id, userId);
    return this.get(userId, id);
  }

  remove(userId: number, id: number): boolean {
    return this.db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  }

  touch(id: number) {
    this.db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(id);
  }

  // ── Mensajes (historial sólo-agregar) ─────────────────────

  append(
    conversationId: number,
    msg: { role: "user" | "assistant" | "system"; kind?: string; apiContent: unknown; displayText?: string; meta?: Record<string, unknown> },
  ): number {
    const res = this.db
      .prepare("INSERT INTO messages (conversation_id, role, kind, api_content, display_text, meta) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        conversationId,
        msg.role,
        msg.kind ?? "chat",
        JSON.stringify(msg.apiContent),
        msg.displayText ?? "",
        JSON.stringify(msg.meta ?? {}),
      );
    this.touch(conversationId);
    return Number(res.lastInsertRowid);
  }

  /** Mensajes en el formato exacto que se envía al proveedor de IA. */
  apiHistory(conversationId: number): ApiMessage[] {
    const rows = this.db
      .prepare("SELECT role, api_content FROM messages WHERE conversation_id = ? AND kind != 'notice' ORDER BY id")
      .all(conversationId) as Array<{ role: ApiMessage["role"]; api_content: string }>;
    return rows.map((r) => ({ role: r.role, content: JSON.parse(r.api_content) }) as ApiMessage);
  }

  visibleMessages(userId: number, conversationId: number): StoredMessage[] | undefined {
    if (!this.get(userId, conversationId)) return undefined;
    const rows = this.db
      .prepare(
        `SELECT id, role, kind, display_text, meta, created_at FROM messages
         WHERE conversation_id = ? AND kind IN (${VISIBLE_KINDS.map(() => "?").join(",")}) ORDER BY id`,
      )
      .all(conversationId, ...VISIBLE_KINDS) as Array<{ id: number; role: StoredMessage["role"]; kind: string; display_text: string; meta: string; created_at: string }>;
    return rows
      .map((r) => ({ ...r, api_content: undefined, meta: JSON.parse(r.meta) as Record<string, unknown> }))
      .filter((m) => m.display_text !== "" || (Array.isArray(m.meta.tools) && m.meta.tools.length > 0));
  }

  searchMessages(userId: number, query: string, limit: number) {
    const like = `%${escapeLike(query.trim())}%`;
    const rows = this.db
      .prepare(
        `SELECT m.role, m.display_text, m.created_at, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ? AND m.kind = 'chat' AND m.display_text LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT ?`,
      )
      .all(userId, like, limit) as Array<{ role: string; display_text: string; created_at: string; title: string }>;
    const q = query.trim().toLowerCase();
    return rows.map((r) => {
      const idx = Math.max(0, r.display_text.toLowerCase().indexOf(q));
      const start = Math.max(0, idx - 120);
      const snippet = (start > 0 ? "…" : "") + r.display_text.slice(start, idx + q.length + 200) + (idx + q.length + 200 < r.display_text.length ? "…" : "");
      return { role: r.role, title: r.title, created_at: r.created_at, snippet };
    });
  }
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
