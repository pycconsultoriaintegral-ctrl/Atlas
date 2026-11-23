import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashPassword, passwordProblem, safeEqual, verifyPassword } from "../auth/passwords.js";
import { SESSION_COOKIE, SESSION_DAYS, type AuthUser } from "../auth/sessions.js";
import type { Services } from "../services.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Cabecera obligatoria en peticiones que modifican datos (protección CSRF). */
export const CSRF_HEADER = "x-atlas-request";

export function isHttps(req: FastifyRequest) {
  return req.protocol === "https";
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

/** Middleware: exige sesión válida (y cabecera anti-CSRF en peticiones de escritura). */
export function requireAuth(services: Services) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = services.sessions.validate(req.cookies[SESSION_COOKIE]);
    if (!user) return reply.code(401).send({ error: "No has iniciado sesión." });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers[CSRF_HEADER] !== "1") {
      return reply.code(403).send({ error: "Solicitud rechazada (falta cabecera de seguridad)." });
    }
    req.user = user;
  };
}

export async function authRoutes(app: FastifyInstance, services: Services) {
  /** Intentos fallidos de inicio de sesión por IP → bloqueo temporal progresivo. */
  const failures = new Map<string, { count: number; until: number }>();
  const checkLock = (ip: string): number => {
    const f = failures.get(ip);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  };
  const registerFailure = (ip: string) => {
    const f = failures.get(ip) ?? { count: 0, until: 0 };
    f.count++;
    if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (f.count - 5));
    failures.set(ip, f);
  };
  const { db, sessions, audit } = services;
  const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

  app.get("/api/auth/status", async (req) => {
    const user = services.sessions.validate(req.cookies[SESSION_COOKIE]);
    return {
      setupRequired: userCount() === 0,
      user: user ? { id: user.id, username: user.username } : null,
    };
  });

  const SetupBody = z.object({
    setupCode: z.string().min(1).max(200),
    username: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}._-]+$/u, "Usa sólo letras, números, punto, guion o guion bajo."),
    password: z.string().max(200),
  });

  app.post("/api/auth/setup", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    if (req.headers[CSRF_HEADER] !== "1") return reply.code(403).send({ error: "Solicitud rechazada." });
    if (userCount() > 0) return reply.code(409).send({ error: "ATLAS ya está configurado." });
    const body = SetupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Datos inválidos." });
    if (!services.config.setupCode || !safeEqual(body.data.setupCode.trim(), services.config.setupCode)) {
      audit.record(null, "system", "auth.setup_failed", {}, req.ip);
      return reply.code(403).send({ error: "Código de configuración incorrecto. Revísalo en la consola del servidor." });
    }
    const problem = passwordProblem(body.data.password);
    if (problem) return reply.code(400).send({ error: problem });
    const hash = await hashPassword(body.data.password);
    const res = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(body.data.username, hash);
    const userId = Number(res.lastInsertRowid);
    const s = sessions.create(userId, { userAgent: req.headers["user-agent"], ip: req.ip });
    setSessionCookie(req, reply, s.token);
    audit.record(userId, "user", "auth.setup", { username: body.data.username }, req.ip);
    return { user: { id: userId, username: body.data.username } };
  });

  const LoginBody = z.object({ username: z.string().max(100), password: z.string().max(200) });

  app.post("/api/auth/login", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req, reply) => {
    if (req.headers[CSRF_HEADER] !== "1") return reply.code(403).send({ error: "Solicitud rechazada." });
    const wait = checkLock(req.ip);
    if (wait) return reply.code(429).send({ error: `Demasiados intentos fallidos. Espera ${wait} segundos.` });
    const body = LoginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Datos inválidos." });
    const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(body.data.username.trim()) as
      | { id: number; username: string; password_hash: string }
      | undefined;
    // Se verifica siempre un hash (aunque el usuario no exista) para no revelar qué usuarios existen.
    const ok = await verifyPassword(body.data.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      registerFailure(req.ip);
      audit.record(row?.id ?? null, "user", "auth.login_failed", { username: body.data.username.slice(0, 40) }, req.ip);
      return reply.code(401).send({ error: "Usuario o contraseña incorrectos." });
    }
    failures.delete(req.ip);
    const s = sessions.create(row.id, { userAgent: req.headers["user-agent"], ip: req.ip });
    setSessionCookie(req, reply, s.token);
    audit.record(row.id, "user", "auth.login", {}, req.ip);
    return { user: { id: row.id, username: row.username } };
  });

  const guard = requireAuth(services);

  app.post("/api/auth/logout", { preHandler: guard }, async (req, reply) => {
    sessions.revoke(req.user!.id, req.user!.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    audit.record(req.user!.id, "user", "auth.logout", {}, req.ip);
    return { ok: true };
  });

  app.get("/api/auth/sessions", { preHandler: guard }, async (req) => {
    return {
      sessions: sessions.list(req.user!.id).map((s) => ({ ...s, current: s.id === req.user!.sessionId })),
    };
  });

  app.delete<{ Params: { id: string } }>("/api/auth/sessions/:id", { preHandler: guard }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!sessions.revoke(req.user!.id, id)) return reply.code(404).send({ error: "Sesión no encontrada." });
    audit.record(req.user!.id, "user", "auth.session_revoked", { sessionId: id }, req.ip);
    return { ok: true };
  });

  app.post("/api/auth/sessions/revoke-others", { preHandler: guard }, async (req) => {
    const n = sessions.revokeAllExcept(req.user!.id, req.user!.sessionId);
    audit.record(req.user!.id, "user", "auth.sessions_revoked", { count: n }, req.ip);
    return { revoked: n };
  });

  const ChangePw = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) });
  app.post("/api/auth/password", { preHandler: guard, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const body = ChangePw.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Datos inválidos." });
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id) as { password_hash: string };
    if (!(await verifyPassword(body.data.currentPassword, row.password_hash)))
      return reply.code(401).send({ error: "La contraseña actual no es correcta." });
    const problem = passwordProblem(body.data.newPassword);
    if (problem) return reply.code(400).send({ error: problem });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(body.data.newPassword), req.user!.id);
    // Cierra todas las demás sesiones por seguridad.
    sessions.revokeAllExcept(req.user!.id, req.user!.sessionId);
    audit.record(req.user!.id, "user", "auth.password_changed", {}, req.ip);
    return { ok: true };
  });
}

// Hash de una contraseña aleatoria: se usa para igualar el tiempo de respuesta.
let DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";
void hashPassword(Math.random().toString(36)).then((h) => (DUMMY_HASH = h));
