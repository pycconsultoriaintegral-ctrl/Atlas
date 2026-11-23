/** Cliente de la API del cerebro central. Las cookies de sesión son httpOnly: el JS nunca ve el token. */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const JSON_HEADERS = { "content-type": "application/json", "x-atlas-request": "1" };

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers: opts.method && opts.method !== "GET" ? JSON_HEADERS : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.method && opts.method !== "GET" ? "{}" : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("No hay conexión con el cerebro de ATLAS. ¿Está encendido el servidor?", 0);
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : {};
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized?.();
    throw new ApiError(data?.error || `Error ${res.status}`, res.status);
  }
  return data as T;
}

export type ChatEvent =
  | { type: "conversation"; id: number; title: string }
  | { type: "status"; state: "thinking" | "writing" | "tool" | "idle"; detail?: string }
  | { type: "text"; delta: string }
  | { type: "step" }
  | { type: "tool"; name: string; label: string; summary: string; status: ToolStatus; actionId?: number }
  | { type: "confirmation"; actionId: number; tool: string; label: string; summary: string }
  | { type: "notice"; level: "info" | "warning"; message: string }
  | { type: "done"; interrupted?: boolean }
  | { type: "error"; message: string; code?: string };

export type ToolStatus = "running" | "ok" | "error" | "pending" | "disabled";

/** POST con respuesta en streaming (Server-Sent Events). */
export async function streamPost(path: string, body: unknown, onEvent: (e: ChatEvent) => void, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...JSON_HEADERS, accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiError("No hay conexión con el cerebro de ATLAS.", 0);
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(data?.error || `Error ${res.status}`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* evento corrupto: se ignora */
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
}

export function clientDevice(): string {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
  const dev = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "navegador";
  return `${dev}${standalone ? " (app ATLAS)" : " (navegador)"}`;
}

export function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// ── Tipos de datos ─────────────────────────────────────────

export interface User {
  id: number;
  username: string;
}
export interface Conversation {
  id: number;
  title: string;
  project_id: number | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
  preview?: string | null;
}
export interface ToolActivity {
  name: string;
  label: string;
  summary: string;
  status: ToolStatus;
  actionId?: number;
}
export interface StoredMessage {
  id: number;
  role: "user" | "assistant" | "system";
  kind: string;
  display_text: string;
  meta: { tools?: ToolActivity[]; interrupted?: boolean; model?: string; fallbackUsed?: boolean };
  created_at: string;
}
export interface PendingActionCard {
  id: number;
  tool: string;
  label: string;
  summary: string;
}
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
}
export interface Task {
  id: number;
  title: string;
  notes: string;
  status: "pending" | "in_progress" | "done" | "cancelled";
  due_at: string | null;
  project_id: number | null;
  project_name: string | null;
  updated_at: string;
}
export interface Device {
  id: number;
  name: string;
  kind: string;
  created_at: string;
  last_seen_at: string | null;
  revoked: boolean;
  state: "offline" | "online" | "busy" | "error";
  currentTask: string | null;
  lastError: string | null;
  hostname: string | null;
  agentVersion: string | null;
}

/** Fechas de SQLite ("2026-11-23 22:15:00", UTC) → texto local. */
export function formatDate(sqlUtc: string | null | undefined, withTime = true): string {
  if (!sqlUtc) return "";
  const d = new Date(sqlUtc.includes("T") ? sqlUtc : sqlUtc.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return sqlUtc;
  return d.toLocaleString("es-419", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}
