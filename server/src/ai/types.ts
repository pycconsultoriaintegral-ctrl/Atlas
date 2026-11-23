import type Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../settings/settings.js";
import type { ToolSpec } from "../tools/registry.js";

/**
 * Formato canónico del historial. Usamos la forma de mensajes de Anthropic
 * (bloques de contenido) porque es la más expresiva; otros proveedores
 * (OpenAI, modelos locales…) convierten desde/hacia este formato en su adaptador.
 */
export type ApiMessage = Anthropic.Beta.BetaMessageParam;

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  description: string;
  /** Precio orientativo en USD por millón de tokens (entrada / salida). */
  pricing?: { input: number; output: number };
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface TurnRequest {
  model: string;
  effort: Effort;
  system: string;
  tools: ToolSpec[];
  messages: ApiMessage[];
  signal: AbortSignal;
  onText: (delta: string) => void;
}

export interface TurnResult {
  /** Contenido exacto devuelto por el proveedor (se guarda y se reenvía sin cambios). */
  content: unknown[];
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "other";
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Se usó el modelo de respaldo porque el principal declinó la solicitud. */
  fallbackUsed?: boolean;
}

export interface AIProvider {
  id: string;
  label: string;
  configured(): boolean;
  models(): ModelInfo[];
  runTurn(req: TurnRequest): Promise<TurnResult>;
}

/** Error con un mensaje apto para mostrar al usuario (sin detalles internos ni secretos). */
export class ProviderError extends Error {
  constructor(
    public userMessage: string,
    public code: "auth" | "rate_limit" | "overloaded" | "bad_request" | "connection" | "aborted" | "unknown",
    cause?: unknown,
  ) {
    super(userMessage, { cause });
  }
}
