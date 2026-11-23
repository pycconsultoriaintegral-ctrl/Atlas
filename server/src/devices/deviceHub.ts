import crypto from "node:crypto";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import { randomToken, sha256 } from "../auth/passwords.js";
import type { DB } from "../db/database.js";

/**
 * Gestión de dispositivos (p. ej. el agente de Windows, Fase 3).
 *
 * Cada dispositivo se vincula con un token propio (distinto de tu contraseña) que
 * puedes revocar en cualquier momento. El agente se conecta por WebSocket al
 * cerebro central; sin token válido la conexión se rechaza.
 */

export type DeviceState = "offline" | "online" | "busy" | "error";

export interface DeviceInfo {
  id: number;
  name: string;
  kind: string;
  created_at: string;
  last_seen_at: string | null;
  revoked: boolean;
  state: DeviceState;
  currentTask: string | null;
  lastError: string | null;
  connectedSince: string | null;
  agentVersion: string | null;
  hostname: string | null;
}

interface Live {
  socket: WebSocket;
  userId: number;
  state: DeviceState;
  currentTask: string | null;
  lastError: string | null;
  connectedSince: string;
  agentVersion: string | null;
  hostname: string | null;
  lastHeartbeat: number;
}

export interface CommandResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

const AgentMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), version: z.string().max(40).optional(), hostname: z.string().max(100).optional() }),
  z.object({ type: z.literal("heartbeat") }),
  z.object({
    type: z.literal("status"),
    state: z.enum(["online", "busy", "error"]),
    task: z.string().max(300).nullish(),
    error: z.string().max(1000).nullish(),
  }),
  z.object({
    type: z.literal("result"),
    commandId: z.string().max(100),
    ok: z.boolean(),
    output: z.unknown().optional(),
    error: z.string().max(4000).optional(),
  }),
]);

export class DeviceHub {
  private live = new Map<number, Live>();
  private pending = new Map<string, { deviceId: number; resolve: (r: CommandResult) => void; timer: NodeJS.Timeout }>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private db: DB,
    private audit: AuditLog,
  ) {
    // Considera desconectado a un agente que no envía latidos en 60 s.
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const l of this.live.values()) if (now - l.lastHeartbeat > 60_000) l.socket.terminate();
    }, 15_000);
    this.sweeper.unref();
  }

  // ── Registro de dispositivos ──────────────────────────────

  create(userId: number, name: string, kind = "windows"): { device: DeviceInfo; token: string } {
    const token = `atlasdev_${randomToken(32)}`;
    const res = this.db
      .prepare("INSERT INTO devices (user_id, name, kind, token_hash) VALUES (?, ?, ?, ?)")
      .run(userId, name.trim(), kind, sha256(token));
    const device = this.list(userId).find((d) => d.id === Number(res.lastInsertRowid))!;
    return { device, token };
  }

  list(userId: number): DeviceInfo[] {
    const rows = this.db
      .prepare("SELECT id, name, kind, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ? ORDER BY id")
      .all(userId) as Array<{ id: number; name: string; kind: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }>;
    return rows.map((r) => {
      const l = this.live.get(r.id);
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        created_at: r.created_at,
        last_seen_at: r.last_seen_at,
        revoked: !!r.revoked_at,
        state: l ? l.state : "offline",
        currentTask: l?.currentTask ?? null,
        lastError: l?.lastError ?? null,
        connectedSince: l?.connectedSince ?? null,
        agentVersion: l?.agentVersion ?? null,
        hostname: l?.hostname ?? null,
      };
    });
  }

  revoke(userId: number, id: number): boolean {
    const ok =
      this.db
        .prepare("UPDATE devices SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
        .run(id, userId).changes > 0;
    if (ok) this.live.get(id)?.socket.close(4001, "revoked");
    return ok;
  }

  authenticate(token: string | undefined): { id: number; userId: number; name: string } | null {
    if (!token || !token.startsWith("atlasdev_") || token.length > 200) return null;
    const row = this.db
      .prepare("SELECT id, user_id, name FROM devices WHERE token_hash = ? AND revoked_at IS NULL")
      .get(sha256(token)) as { id: number; user_id: number; name: string } | undefined;
    return row ? { id: row.id, userId: row.user_id, name: row.name } : null;
  }

  // ── Conexión en vivo ─────────────────────────────────────

  attach(device: { id: number; userId: number; name: string }, socket: WebSocket, ip?: string) {
    this.live.get(device.id)?.socket.close(4000, "replaced");
    const entry: Live = {
      socket,
      userId: device.userId,
      state: "online",
      currentTask: null,
      lastError: null,
      connectedSince: new Date().toISOString(),
      agentVersion: null,
      hostname: null,
      lastHeartbeat: Date.now(),
    };
    this.live.set(device.id, entry);
    this.touch(device.id);
    this.audit.record(device.userId, `device:${device.id}`, "device.connected", { name: device.name }, ip);

    socket.on("message", (raw: Buffer) => {
      entry.lastHeartbeat = Date.now();
      let parsed;
      try {
        parsed = AgentMessage.safeParse(JSON.parse(raw.toString("utf8").slice(0, 200_000)));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const msg = parsed.data;
      switch (msg.type) {
        case "hello":
          entry.agentVersion = msg.version ?? null;
          entry.hostname = msg.hostname ?? null;
          break;
        case "heartbeat":
          this.touch(device.id);
          break;
        case "status":
          entry.state = msg.state;
          entry.currentTask = msg.task ?? null;
          entry.lastError = msg.error ?? null;
          break;
        case "result": {
          const p = this.pending.get(msg.commandId);
          if (p && p.deviceId === device.id) {
            clearTimeout(p.timer);
            this.pending.delete(msg.commandId);
            p.resolve({ ok: msg.ok, output: msg.output, error: msg.error });
          }
          break;
        }
      }
    });

    socket.on("close", () => {
      if (this.live.get(device.id)?.socket === socket) this.live.delete(device.id);
      this.touch(device.id);
      for (const [cid, p] of this.pending) {
        if (p.deviceId === device.id) {
          clearTimeout(p.timer);
          this.pending.delete(cid);
          p.resolve({ ok: false, error: "El dispositivo se desconectó antes de terminar." });
        }
      }
      try {
        this.audit.record(device.userId, `device:${device.id}`, "device.disconnected", { name: device.name });
      } catch {
        /* apagado del servidor */
      }
    });
  }

  isOnline(deviceId: number): boolean {
    return this.live.has(deviceId);
  }

  /** Envía una orden a un dispositivo y espera su resultado (usado desde la Fase 3). */
  sendCommand(userId: number, deviceId: number, action: string, params: unknown, timeoutMs = 120_000): Promise<CommandResult> {
    const l = this.live.get(deviceId);
    if (!l || l.userId !== userId) {
      return Promise.resolve({ ok: false, error: "El dispositivo no está conectado." });
    }
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: "El dispositivo no respondió a tiempo." });
      }, timeoutMs);
      this.pending.set(id, { deviceId, resolve, timer });
      l.socket.send(JSON.stringify({ type: "command", id, action, params }));
    });
  }

  /** Botón de emergencia: ordena a todos los agentes del usuario detenerse. */
  stopAll(userId: number): number {
    let n = 0;
    for (const [, l] of this.live) {
      if (l.userId !== userId) continue;
      l.socket.send(JSON.stringify({ type: "stop", reason: "emergency" }));
      n++;
    }
    for (const [cid, p] of this.pending) {
      const l = this.live.get(p.deviceId);
      if (l?.userId === userId) {
        clearTimeout(p.timer);
        this.pending.delete(cid);
        p.resolve({ ok: false, error: "Detenido por el botón de emergencia." });
      }
    }
    return n;
  }

  close() {
    clearInterval(this.sweeper);
    for (const [, l] of this.live) l.socket.close(1001, "server shutdown");
  }

  private touch(id: number) {
    try {
      this.db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(id);
    } catch {
      /* base de datos cerrada (apagado del servidor) */
    }
  }
}
