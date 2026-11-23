import type { DB } from "../db/database.js";
import { randomToken, sha256 } from "./passwords.js";

export const SESSION_COOKIE = "atlas_session";
export const SESSION_DAYS = 30;

export interface SessionRow {
  id: number;
  label: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export interface AuthUser {
  id: number;
  username: string;
  sessionId: number;
}

/**
 * Sesiones con token aleatorio de 256 bits. En la base de datos sólo se guarda el
 * hash SHA-256 del token: una copia robada de la base de datos no permite entrar.
 */
export class SessionStore {
  constructor(private db: DB) {}

  create(userId: number, info: { userAgent?: string; ip?: string }): { token: string; id: number } {
    const token = randomToken(32);
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    const res = this.db
      .prepare(
        "INSERT INTO sessions (user_id, token_hash, label, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(userId, sha256(token), describeAgent(info.userAgent), info.userAgent?.slice(0, 300) ?? null, info.ip ?? null, expires);
    return { token, id: Number(res.lastInsertRowid) };
  }

  validate(token: string | undefined): AuthUser | null {
    if (!token || token.length > 200) return null;
    const row = this.db
      .prepare(
        `SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.id AS uid, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(sha256(token)) as
      | { sid: number; expires_at: string; last_seen_at: string; uid: number; username: string }
      | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.revoke(row.uid, row.sid);
      return null;
    }
    // Actualiza "visto por última vez" como máximo una vez por minuto.
    if (Date.now() - new Date(row.last_seen_at.replace(" ", "T") + "Z").getTime() > 60_000) {
      this.db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(row.sid);
    }
    return { id: row.uid, username: row.username, sessionId: row.sid };
  }

  list(userId: number): SessionRow[] {
    return this.db
      .prepare(
        "SELECT id, label, ip, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC",
      )
      .all(userId) as unknown as SessionRow[];
  }

  revoke(userId: number, sessionId: number): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(sessionId, userId).changes > 0;
  }

  revokeAllExcept(userId: number, keepId: number): number {
    return Number(this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepId).changes);
  }
}

function describeAgent(ua?: string): string {
  if (!ua) return "Dispositivo desconocido";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Dispositivo";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Navegador";
  return `${device} · ${browser}`;
}
