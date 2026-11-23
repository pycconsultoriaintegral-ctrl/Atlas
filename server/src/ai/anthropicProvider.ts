import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ModelInfo, TurnRequest, TurnResult } from "./types.js";
import { ProviderError } from "./types.js";

/**
 * Proveedor Anthropic (Claude). La API key sólo vive en el servidor (.env);
 * nunca se envía al navegador ni se escribe en los registros.
 */
export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    description: "Máxima calidad para el día a día (recomendado).",
    pricing: { input: 4, output: 20 },
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    description: "Rápido y capaz, a la mitad de precio.",
    pricing: { input: 2, output: 10 },
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "anthropic",
    description: "El más rápido y económico, para tareas simples.",
    pricing: { input: 0.1, output: 0.5 },
  },
  {
    id: "claude-fable-5-2",
    label: "Claude Fable 5.2",
    provider: "anthropic",
    description: "El más capaz para problemas muy complejos (más caro y lento).",
    pricing: { input: 8, output: 40 },
  },
];

/**
 * Modelos que admiten el respaldo automático del servidor: si el modelo declina
 * una solicitud por sus filtros de seguridad, la API la reintenta con otro modelo
 * dentro de la misma llamada.
 */
const SERVER_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"]);

export class AnthropicProvider implements AIProvider {
  id = "anthropic";
  label = "Anthropic (Claude)";
  private client: Anthropic | null;

  constructor(apiKey: string | undefined, opts: { baseURL?: string; maxRetries?: number } = {}) {
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: opts.maxRetries ?? 2, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) }) : null;
  }

  configured() {
    return this.client !== null;
  }

  models() {
    return ANTHROPIC_MODELS;
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    if (!this.client) throw new ProviderError("Falta configurar ANTHROPIC_API_KEY en el servidor.", "auth");
    const fallback = SERVER_FALLBACK_MODELS.has(req.model);

    const stream = this.client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: 64000,
        // Instrucciones de sistema congeladas por conversación + caché automática
        // del prefijo (reduce el costo de las conversaciones largas ~90 %).
        system: [{ type: "text", text: req.system }],
        cache_control: { type: "ephemeral" },
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages: req.messages,
        output_config: { effort: req.effort },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: req.signal },
    );

    stream.on("text", (delta) => req.onText(delta));

    let message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      throw mapError(err, req.signal);
    }

    const toolCalls = [];
    let text = "";
    let fallbackUsed = false;
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input });
      else if (block.type === "fallback") fallbackUsed = true;
    }

    const sr = message.stop_reason;
    return {
      content: message.content as unknown[],
      text,
      toolCalls,
      stopReason:
        sr === "end_turn" || sr === "tool_use" || sr === "max_tokens" || sr === "refusal" || sr === "pause_turn" ? sr : "other",
      model: message.model,
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
      fallbackUsed,
    };
  }
}

function mapError(err: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted || err instanceof Anthropic.APIUserAbortError) return new ProviderError("Respuesta detenida.", "aborted", err);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("La API key de Anthropic no es válida o no tiene permisos. Revísala en el archivo .env.", "auth", err);
  if (err instanceof Anthropic.RateLimitError)
    return new ProviderError("Se alcanzó el límite de uso de la API de Anthropic. Espera un momento e inténtalo de nuevo.", "rate_limit", err);
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.message || "";
    if (/credit balance|billing/i.test(msg))
      return new ProviderError("Tu cuenta de Anthropic no tiene saldo. Agrega créditos en console.anthropic.com → Billing.", "bad_request", err);
    return new ProviderError(`La API rechazó la solicitud: ${msg.slice(0, 300)}`, "bad_request", err);
  }
  if (err instanceof Anthropic.InternalServerError || (err instanceof Anthropic.APIError && err.status === 529))
    return new ProviderError("El servicio de Anthropic está saturado en este momento. Inténtalo en unos segundos.", "overloaded", err);
  if (err instanceof Anthropic.APIConnectionError)
    return new ProviderError("No hay conexión con Anthropic. Revisa la conexión a internet del servidor.", "connection", err);
  if (err instanceof Anthropic.APIError) return new ProviderError(`Error de la API (${err.status ?? "?"}).`, "unknown", err);
  return new ProviderError("Ocurrió un error inesperado al consultar la IA.", "unknown", err);
}
