import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Abre un flujo Server-Sent Events sobre una petición POST (fetch + streaming).
 * Si el cliente cierra la conexión (botón "detener", app cerrada…), se aborta.
 */
export function openSse(req: FastifyRequest, reply: FastifyReply, controller: AbortController) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  let closed = false;
  const onClose = () => {
    if (!res.writableFinished) controller.abort(new Error("client closed"));
    closed = true;
  };
  req.raw.on("close", onClose);
  res.on("close", onClose);
  // Latido para que proxies y Safari no corten el flujo en respuestas largas.
  const ping = setInterval(() => {
    if (!closed) res.write(": ping\n\n");
  }, 15_000);

  return {
    send(event: { type: string; [k: string]: unknown }) {
      if (closed) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      clearInterval(ping);
      if (!closed) res.end();
      closed = true;
    },
  };
}
