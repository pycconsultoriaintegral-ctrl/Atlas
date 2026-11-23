import fs from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { authRoutes } from "./http/auth.js";
import { apiRoutes } from "./http/routes.js";
import { createServices, type Services } from "./services.js";

export interface BuiltApp {
  app: FastifyInstance;
  services: Services;
  /** Rutas registradas (para pruebas de seguridad). */
  routes: Array<{ method: string; url: string }>;
}

export async function buildApp(config: AppConfig): Promise<BuiltApp> {
  const db = openDatabase(config.dbFile);
  const services = createServices(config, db);

  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: "info",
          // Nunca registrar cookies ni cabeceras de autorización.
          redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
        },
    bodyLimit: 1024 * 1024,
    // Confía sólo en un proxy local (p. ej. "tailscale serve" o Caddy en el mismo equipo).
    trustProxy: ["127.0.0.1", "::1"],
  });

  const routes: BuiltApp["routes"] = [];
  app.addHook("onRoute", (r) => {
    for (const m of [r.method].flat()) routes.push({ method: String(m), url: r.url });
  });

  // JSON con cuerpo vacío se interpreta como {} (p. ej. botones que sólo hacen POST).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = String(body ?? "").trim();
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error("JSON inválido") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "blob:"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: false, // la terminación HTTPS (Tailscale/Caddy) gestiona HSTS
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  await authRoutes(app, services);
  await apiRoutes(app, services);

  // ── WebSocket del agente de Windows (Fase 3) ─────────────
  app.get("/ws/agent", { websocket: true, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, (socket, req) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
    const device = services.devices.authenticate(token);
    if (!device) {
      services.audit.record(null, "system", "device.auth_failed", {}, req.ip);
      socket.close(4401, "unauthorized");
      return;
    }
    services.devices.attach(device, socket, req.ip);
  });

  // ── Interfaz web compilada (PWA) ─────────────────────────
  if (fs.existsSync(path.join(config.webDistDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      wildcard: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("sw.js") || filePath.endsWith("index.html") || filePath.endsWith(".webmanifest")) {
          res.header("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/ws/")) {
        return reply.header("Cache-Control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: "No encontrado." });
    });
  } else {
    app.get("/", async (_req, reply) =>
      reply
        .type("text/html; charset=utf-8")
        .send("<h1>ATLAS</h1><p>El servidor funciona. Falta compilar la interfaz: ejecuta <code>npm run build</code>.</p>"),
    );
  }

  app.addHook("onClose", async () => {
    services.devices.close();
    db.close();
  });

  return { app, services, routes };
}
