import type { AIProvider, ApiMessage, ModelInfo, ToolCall, TurnRequest, TurnResult } from "./types.js";
import { ProviderError } from "./types.js";

/**
 * Proveedor de demostración: funciona sin API key ni internet. Sirve para probar
 * la interfaz y para las pruebas automáticas. Siempre se identifica como demo,
 * para no confundirse nunca con la IA real.
 */
export const MOCK_MODEL: ModelInfo = {
  id: "atlas-demo",
  label: "Modo demostración (sin IA)",
  provider: "mock",
  description: "Respuestas simuladas para probar ATLAS sin API key.",
};

let counter = 0;

export class MockProvider implements AIProvider {
  id = "mock";
  label = "Demostración";
  configured() {
    return true;
  }
  models() {
    return [MOCK_MODEL];
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const results = lastUser && Array.isArray(lastUser.content) ? lastUser.content.filter((b: any) => b.type === "tool_result") : [];

    let text: string;
    let toolCalls: ToolCall[] = [];

    if (results.length && lastUser === lastNonSystem(req.messages)) {
      const summary = results.map((r: any) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
      text = `(Modo demostración) Resultado de la herramienta:\n\n${summary}`;
    } else if (/^[✅❌]/u.test(lastUserText(req.messages))) {
      // Decisión sobre una acción pendiente: informa el resultado que dejó el servidor.
      const note = lastSystemText(req.messages);
      const result = note.match(/<untrusted_content[^>]*>\n([\s\S]*?)\n<\/untrusted_content>/)?.[1];
      text = /APROBÓ/.test(note)
        ? `(Modo demostración) Acción aprobada y ejecutada. Resultado: ${result ?? "sin detalles"}`
        : "(Modo demostración) Entendido: la acción fue rechazada y no se ejecutó.";
    } else {
      const said = lastUserText(req.messages);
      const call = this.pickTool(said);
      if (call) {
        toolCalls = [call];
        text = "";
      } else {
        text =
          `(Modo demostración) Recibí tu mensaje: «${said.slice(0, 300)}».\n\n` +
          "Todavía no hay una IA real conectada. Para activarla, agrega tu API key de Anthropic en el archivo `.env` " +
          "(ver README → «Configurar la IA»). Mientras tanto puedes probar: «recuerda que …», «mis tareas», «crea una tarea: …».";
      }
    }
    void last;

    for (const chunk of text.match(/.{1,12}/gs) ?? []) {
      if (req.signal.aborted) throw new ProviderError("Respuesta detenida.", "aborted");
      req.onText(chunk);
      await new Promise((r) => setTimeout(r, 8));
    }

    const content: unknown[] = [];
    if (text) content.push({ type: "text", text });
    for (const c of toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
    return {
      content,
      text,
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : "end_turn",
      model: MOCK_MODEL.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }

  private pickTool(said: string): ToolCall | null {
    const id = () => `toolu_demo_${Date.now()}_${++counter}`;
    let m: RegExpMatchArray | null;
    if ((m = said.match(/^\s*(?:atlas,?\s*)?(?:recuerda|anota|no olvides)\s+(?:que\s+)?(.+)$/is)))
      return { id: id(), name: "memory_save", input: { content: m[1]!.trim() } };
    if ((m = said.match(/(?:borra|elimina)\s+(?:el\s+)?recuerdo\s+#?(\d+)/i)))
      return { id: id(), name: "memory_delete", input: { id: Number(m[1]) } };
    if ((m = said.match(/crea(?:r)?\s+(?:una\s+)?tarea:?\s+(.+)$/is)))
      return { id: id(), name: "task_create", input: { title: m[1]!.trim() } };
    if (/\b(mis\s+tareas|pendientes|qu[eé]\s+tengo\s+que\s+hacer)\b/i.test(said)) return { id: id(), name: "task_list", input: {} };
    if (/\b(qu[eé]\s+recuerdas|mi\s+memoria)\b/i.test(said)) return { id: id(), name: "memory_search", input: {} };
    if (/\b(computador|pc|dispositivos?)\b/i.test(said)) return { id: id(), name: "device_status", input: {} };
    return null;
  }
}

function lastNonSystem(messages: ApiMessage[]) {
  return [...messages].reverse().find((m) => m.role !== "system");
}

function lastSystemText(messages: ApiMessage[]): string {
  const m = [...messages].reverse().find((x) => x.role === "system");
  if (!m) return "";
  return typeof m.content === "string" ? m.content : ((m.content ?? []) as any[]).map((b) => b.text ?? "").join("\n");
}

function lastUserText(messages: ApiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const t = (m.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (t) return t;
  }
  return "";
}
