import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AnthropicProvider } from "../src/ai/anthropicProvider.js";

/**
 * Servidor falso que imita la API de streaming de Anthropic: permite verificar
 * exactamente qué envía ATLAS (sin gastar dinero ni necesitar API key real).
 */
function fakeAnthropic(events: object[], status = 200) {
  const received: Array<{ headers: http.IncomingHttpHeaders; body: any; url: string }> = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: JSON.parse(data || "{}"), url: req.url ?? "" });
      if (status !== 200) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const e of events) res.write(`event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  });
  return new Promise<{ url: string; received: typeof received; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, received, close: () => server.close() });
    }),
  );
}

const message = (stop: string) => [
  {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hola, " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "voy a guardarlo." } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "memory_save", input: {} } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"content":"Le gusta el té"}' } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
];

let close: (() => void) | undefined;
afterEach(() => close?.());

describe("proveedor Anthropic", () => {
  it("envía la petición correcta y procesa texto + herramientas en streaming", async () => {
    const fake = await fakeAnthropic(message("tool_use"));
    close = fake.close;
    const p = new AnthropicProvider("sk-ant-test", { baseURL: fake.url, maxRetries: 0 });
    const deltas: string[] = [];
    const out = await p.runTurn({
      model: "claude-opus-5-5",
      effort: "medium",
      system: "Eres ATLAS",
      tools: [{ name: "memory_save", description: "d", input_schema: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "Recuerda que me gusta el té" }] },
        { role: "system", content: "<atlas_context>…</atlas_context>" },
      ],
      signal: new AbortController().signal,
      onText: (d) => deltas.push(d),
    });

    expect(deltas.join("")).toBe("Hola, voy a guardarlo.");
    expect(out.stopReason).toBe("tool_use");
    expect(out.toolCalls).toEqual([{ id: "toolu_1", name: "memory_save", input: { content: "Le gusta el té" } }]);

    const req = fake.received[0]!;
    expect(req.url).toContain("/v1/messages");
    // El SDK 1.x envía la clave como "Authorization: Bearer".
    expect(req.headers["x-api-key"] ?? req.headers.authorization).toMatch(/sk-ant-test/);
    expect(String(req.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(req.body.model).toBe("claude-opus-5-5");
    expect(req.body.stream).toBe(true);
    expect(req.body.fallbacks).toBe("default");
    expect(req.body.output_config).toEqual({ effort: "medium" });
    expect(req.body.cache_control).toEqual({ type: "ephemeral" });
    expect(req.body.thinking).toBeUndefined();
    expect(req.body.messages[1].role).toBe("system");
  });

  it("no usa respaldo de servidor con Haiku y traduce errores de autenticación", async () => {
    const fake = await fakeAnthropic([], 401);
    close = fake.close;
    const p = new AnthropicProvider("sk-ant-malo", { baseURL: fake.url, maxRetries: 0 });
    await expect(
      p.runTurn({
        model: "claude-haiku-5-5",
        effort: "low",
        system: "x",
        tools: [],
        messages: [{ role: "user", content: "hola" }],
        signal: new AbortController().signal,
        onText: () => {},
      }),
    ).rejects.toMatchObject({ code: "auth" });
    expect(fake.received[0]!.body.fallbacks).toBeUndefined();
  });
});
