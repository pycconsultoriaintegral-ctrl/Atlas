import { z } from "zod";
import { buildSystemPrompt, buildTurnContext } from "../ai/prompts.js";
import type { ApiMessage, TurnResult } from "../ai/types.js";
import { ProviderError } from "../ai/types.js";
import { tx } from "../db/database.js";
import { wrapUntrusted } from "../security/untrusted.js";
import type { Services } from "../services.js";
import type { ToolSpec } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";

/** Eventos que se transmiten en vivo a la interfaz (Server-Sent Events). */
export type ChatEvent =
  | { type: "conversation"; id: number; title: string }
  | { type: "status"; state: "thinking" | "writing" | "tool" | "idle"; detail?: string }
  | { type: "text"; delta: string }
  | { type: "step"; }
  | { type: "tool"; name: string; label: string; summary: string; status: "running" | "ok" | "error" | "pending" | "disabled"; actionId?: number }
  | { type: "confirmation"; actionId: number; tool: string; label: string; summary: string }
  | { type: "notice"; level: "info" | "warning"; message: string }
  | { type: "done"; interrupted?: boolean }
  | { type: "error"; message: string; code?: string };

export type Emit = (e: ChatEvent) => void;

/** Máximo de rondas IA→herramientas por turno (evita bucles infinitos). */
const MAX_STEPS = 10;

export interface ToolActivity {
  name: string;
  label: string;
  summary: string;
  status: "ok" | "error" | "pending" | "disabled";
  actionId?: number;
}

export function newConversation(services: Services, userId: number, opts: { title?: string; projectId?: number | null } = {}) {
  return services.conversations.create(userId, {
    title: opts.title,
    projectId: opts.projectId,
    systemPrompt: buildSystemPrompt(),
    toolsJson: JSON.stringify(services.tools.specs()),
  });
}

/** Agrega el mensaje del usuario + el contexto del turno al historial. */
export function appendUserTurn(
  services: Services,
  userId: number,
  conversationId: number,
  input: {
    text: string;
    kind?: "chat" | "action_decision";
    clientTimezone?: string;
    clientDevice?: string;
    /** Información del servidor para este turno (p. ej. resultado de una acción aprobada). */
    systemNote?: string;
  },
) {
  let ctxText = buildTurnContext(services, userId, {
    userText: input.text,
    conversationId,
    clientTimezone: input.clientTimezone,
    clientDevice: input.clientDevice,
  });
  if (input.systemNote) ctxText = `${input.systemNote}\n\n${ctxText}`;
  tx(services.db, () => {
    services.conversations.append(conversationId, {
      role: "user",
      kind: input.kind ?? "chat",
      apiContent: [{ type: "text", text: input.text }],
      displayText: input.text,
    });
    // Mensaje de sistema a mitad de conversación: se agrega (nunca se edita el
    // historial), así el prefijo y la caché se mantienen estables.
    services.conversations.append(conversationId, { role: "system", kind: "context", apiContent: ctxText });
  });
}

/**
 * Ejecuta un turno completo de ATLAS: llama a la IA, ejecuta herramientas
 * autorizadas, pide confirmación de las sensibles y repite hasta terminar.
 */
export async function runAssistantTurn(
  services: Services,
  userId: number,
  conversationId: number,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const settings = services.settings.get(userId);
  const { provider, model, demo } = services.providers.resolve(settings.model);
  const frozen = services.conversations.frozen(userId, conversationId);
  if (!frozen) throw new Error("Conversación no encontrada");
  const tools = JSON.parse(frozen.toolsJson || "[]") as ToolSpec[];

  if (demo) {
    emit({
      type: "notice",
      level: "warning",
      message: "Modo demostración: no hay API key de IA configurada, las respuestas son simuladas.",
    });
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    if (step > 0) emit({ type: "step" });
    emit({ type: "status", state: "thinking" });
    const history = services.conversations.apiHistory(conversationId);

    let partial = "";
    let result: TurnResult;
    try {
      result = await provider.runTurn({
        model,
        effort: settings.effort,
        system: frozen.systemPrompt,
        tools,
        messages: history,
        signal,
        onText: (delta) => {
          if (!partial) emit({ type: "status", state: "writing" });
          partial += delta;
          emit({ type: "text", delta });
        },
      });
    } catch (err) {
      if (err instanceof ProviderError && err.code === "aborted") {
        // Guarda lo que alcanzó a escribir, marcado como interrumpido.
        if (partial.trim()) {
          services.conversations.append(conversationId, {
            role: "assistant",
            apiContent: [{ type: "text", text: partial }],
            displayText: partial,
            meta: { model, interrupted: true },
          });
        }
        emit({ type: "done", interrupted: true });
        return;
      }
      throw err;
    }

    const meta: Record<string, unknown> = { model: result.model, usage: result.usage, stopReason: result.stopReason };
    if (result.fallbackUsed) meta.fallbackUsed = true;

    // Respuesta sin herramientas → fin del turno.
    if (result.stopReason !== "tool_use" || result.toolCalls.length === 0) {
      let display = result.text;
      if (result.stopReason === "refusal") {
        display += (display ? "\n\n" : "") + "_(El modelo declinó continuar con esta solicitud por sus políticas de seguridad.)_";
      } else if (result.stopReason === "max_tokens") {
        display += "\n\n_(Respuesta cortada por longitud máxima.)_";
      }
      services.conversations.append(conversationId, {
        role: "assistant",
        apiContent: result.content,
        displayText: display,
        meta,
      });
      if (result.stopReason === "pause_turn") continue;
      emit({ type: "done" });
      return;
    }

    // ── Ejecutar herramientas ────────────────────────────
    emit({ type: "status", state: "tool" });
    const toolResults: unknown[] = [];
    const activity: ToolActivity[] = [];
    for (const call of result.toolCalls) {
      const r = await executeToolCall(services, userId, conversationId, call, settings, emit, signal);
      toolResults.push({ type: "tool_result", tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      activity.push(r.activity);
    }

    // El mensaje de la IA y los resultados se guardan juntos (nunca queda una
    // llamada a herramienta sin su resultado).
    tx(services.db, () => {
      services.conversations.append(conversationId, {
        role: "assistant",
        apiContent: result.content,
        displayText: result.text,
        meta: { ...meta, tools: activity },
      });
      services.conversations.append(conversationId, { role: "user", kind: "tool_result", apiContent: toolResults });
    });

    if (signal.aborted) {
      emit({ type: "done", interrupted: true });
      return;
    }
  }

  services.conversations.append(conversationId, {
    role: "assistant",
    kind: "notice",
    apiContent: [],
    displayText: "Detuve la tarea porque requería demasiados pasos seguidos. Puedes pedirme que continúe.",
  });
  emit({ type: "notice", level: "warning", message: "Se alcanzó el máximo de pasos por respuesta." });
  emit({ type: "done" });
}

async function executeToolCall(
  services: Services,
  userId: number,
  conversationId: number,
  call: { id: string; name: string; input: unknown },
  settings: ReturnType<Services["settings"]["get"]>,
  emit: Emit,
  signal: AbortSignal,
): Promise<{ content: string; isError?: boolean; activity: ToolActivity }> {
  const def = services.tools.get(call.name);
  const ctx: ToolContext = { userId, conversationId, services, signal };
  if (!def) {
    return {
      content: `La herramienta "${call.name}" no existe.`,
      isError: true,
      activity: { name: call.name, label: call.name, summary: "Herramienta desconocida", status: "error" },
    };
  }

  const parsed = def.schema.safeParse(call.input);
  if (!parsed.success) {
    const msg = `Parámetros inválidos para ${def.name}: ${z.prettifyError(parsed.error).slice(0, 500)}`;
    return { content: msg, isError: true, activity: { name: def.name, label: def.label, summary: "Parámetros inválidos", status: "error" } };
  }
  const input = parsed.data;
  let summary: string;
  try {
    summary = def.summarize(input, ctx);
  } catch {
    summary = def.label;
  }

  const permission = services.tools.permission(def.name, settings);
  if (permission === "disabled") {
    services.audit.record(userId, "atlas", "tool.blocked", { tool: def.name, summary });
    emit({ type: "tool", name: def.name, label: def.label, summary, status: "disabled" });
    return {
      content: "Esta herramienta está desactivada por el usuario en Configuración. No se ejecutó.",
      isError: true,
      activity: { name: def.name, label: def.label, summary, status: "disabled" },
    };
  }

  if (permission === "confirm") {
    const action = services.actions.create(userId, conversationId, def.name, input, summary);
    services.audit.record(userId, "atlas", "action.requested", { actionId: action.id, tool: def.name, summary });
    emit({ type: "tool", name: def.name, label: def.label, summary, status: "pending", actionId: action.id });
    emit({ type: "confirmation", actionId: action.id, tool: def.name, label: def.label, summary });
    return {
      content: `PENDIENTE DE CONFIRMACIÓN (acción #${action.id}): "${summary}". La acción NO se ha ejecutado. El usuario debe aprobarla o rechazarla con el botón que aparece en pantalla.`,
      activity: { name: def.name, label: def.label, summary, status: "pending", actionId: action.id },
    };
  }

  emit({ type: "tool", name: def.name, label: def.label, summary, status: "running" });
  const out = await runTool(services, userId, def.name, input, ctx, summary);
  emit({ type: "tool", name: def.name, label: def.label, summary, status: out.isError ? "error" : "ok" });
  return { ...out, activity: { name: def.name, label: def.label, summary, status: out.isError ? "error" : "ok" } };
}

/** Ejecuta una herramienta ya autorizada, con auditoría y manejo de errores. */
export async function runTool(
  services: Services,
  userId: number,
  name: string,
  input: unknown,
  ctx: ToolContext,
  summary: string,
): Promise<{ content: string; isError?: boolean }> {
  const def = services.tools.get(name)!;
  try {
    const out = await def.run(input, ctx);
    services.audit.record(userId, "atlas", out.isError ? "tool.failed" : "tool.executed", { tool: name, summary });
    const content = out.untrusted ? wrapUntrusted(out.source ?? name, out.content) : out.content;
    return { content, isError: out.isError };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    services.audit.record(userId, "atlas", "tool.failed", { tool: name, summary, error: msg.slice(0, 300) });
    return { content: `Error al ejecutar ${name}: ${msg.slice(0, 500)}`, isError: true };
  }
}

/** Título automático a partir del primer mensaje. */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "Nueva conversación";
}

export type { ApiMessage };
