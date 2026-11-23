import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ProviderError } from "../ai/types.js";
import { appendUserTurn, newConversation, runAssistantTurn, runTool, titleFrom, type ChatEvent } from "../chat/orchestrator.js";
import { MEMORY_CATEGORIES } from "../memory/memoryRepo.js";
import { redactSecrets } from "../security/redact.js";
import type { Services } from "../services.js";
import { EFFORTS, PERMISSION_MODES } from "../settings/settings.js";
import { TASK_STATUSES } from "../tasks/taskRepo.js";
import { wrapUntrusted } from "../security/untrusted.js";
import { requireAuth } from "./auth.js";
import { openSse } from "./sse.js";

const Id = z.coerce.number().int().positive();

function bad(reply: FastifyReply, err: z.ZodError) {
  return reply.code(400).send({ error: err.issues[0]?.message ?? "Datos inválidos." });
}

export async function apiRoutes(app: FastifyInstance, s: Services) {
  const guard = requireAuth(s);
  // Toda la API exige sesión, salvo /api/auth/* (que protege sus propias rutas) y /api/health.
  // Se usa la ruta reconocida por el enrutador (no la URL cruda) para evitar trucos con la URL.
  app.addHook("preHandler", async (req, reply) => {
    const route = req.routeOptions.url ?? "";
    if (route.startsWith("/api/") && !route.startsWith("/api/auth/") && route !== "/api/health") {
      return guard(req, reply);
    }
  });

  app.get("/api/health", async () => ({ ok: true, name: "ATLAS" }));

  app.get("/api/system/status", async (req) => {
    const settings = s.settings.get(req.user!.id);
    const { model, demo } = s.providers.resolve(settings.model);
    const devices = s.devices.list(req.user!.id).filter((d) => !d.revoked);
    return {
      version: "0.1.0",
      ai: { demo, model, configured: s.providers.hasRealProvider() },
      devices: { total: devices.length, online: devices.filter((d) => d.state !== "offline").length },
      pendingActions: s.actions.list(req.user!.id, "pending").length,
    };
  });

  // ── Chat ─────────────────────────────────────────────────
  const ChatBody = z.object({
    conversationId: Id.optional(),
    message: z.string().trim().min(1, "El mensaje está vacío.").max(20_000, "El mensaje es demasiado largo."),
    timezone: z.string().max(60).optional(),
    device: z.string().max(80).optional(),
    projectId: Id.nullable().optional(),
  });

  app.post("/api/chat", async (req, reply) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const userId = req.user!.id;
    let conv = body.data.conversationId ? s.conversations.get(userId, body.data.conversationId) : undefined;
    if (body.data.conversationId && !conv) return reply.code(404).send({ error: "Conversación no encontrada." });
    if (!conv) {
      if (body.data.projectId && !s.memory.getProject(userId, body.data.projectId))
        return reply.code(400).send({ error: "Proyecto no encontrado." });
      conv = newConversation(s, userId, { title: titleFrom(body.data.message), projectId: body.data.projectId ?? null });
    }
    const controller = s.active.begin(userId, conv.id);
    if (!controller) return reply.code(409).send({ error: "ATLAS ya está respondiendo en esta conversación." });

    appendUserTurn(s, userId, conv.id, {
      text: body.data.message,
      clientTimezone: body.data.timezone,
      clientDevice: body.data.device,
    });
    await streamTurn(req, reply, s, userId, conv.id, conv.title, controller);
  });

  app.post<{ Params: { id: string } }>("/api/conversations/:id/stop", async (req) => {
    return { stopped: s.active.stop(req.user!.id, Number(req.params.id)) };
  });

  // ── Acciones pendientes de confirmación ─────────────────
  app.get<{ Querystring: { status?: string } }>("/api/actions", async (req) => {
    const st = req.query.status === "pending" ? "pending" : undefined;
    return { actions: s.actions.list(req.user!.id, st).map((a) => ({ ...a, input: redactSecrets(a.input) })) };
  });

  const Decision = z.object({ timezone: z.string().max(60).optional(), device: z.string().max(80).optional() });

  for (const decision of ["approve", "reject"] as const) {
    app.post<{ Params: { id: string } }>(`/api/actions/:id/${decision}`, async (req, reply) => {
      const userId = req.user!.id;
      const id = Id.safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: "Id inválido." });
      const body = Decision.safeParse(req.body ?? {});
      if (!body.success) return bad(reply, body.error);
      const action = s.actions.get(userId, id.data);
      if (!action) return reply.code(404).send({ error: "Acción no encontrada." });
      if (action.status !== "pending") return reply.code(409).send({ error: `Esta acción ya no está pendiente (${action.status}).` });

      const convId = action.conversation_id;
      const controller = convId ? s.active.begin(userId, convId) : new AbortController();
      if (!controller) return reply.code(409).send({ error: "Espera a que ATLAS termine de responder." });

      if (!s.actions.decide(userId, action.id, decision === "approve" ? "approved" : "rejected")) {
        if (convId) s.active.end(convId, controller);
        return reply.code(409).send({ error: "Esta acción ya fue decidida." });
      }

      let note: string;
      let display: string;
      if (decision === "approve") {
        s.audit.record(userId, "user", "action.approved", { actionId: action.id, tool: action.tool_name, summary: action.summary }, req.ip);
        const def = s.tools.get(action.tool_name);
        const parsed = def?.schema.safeParse(action.input);
        let result: { content: string; isError?: boolean };
        if (!def || !parsed?.success) {
          result = { content: "La herramienta ya no está disponible o los parámetros no son válidos.", isError: true };
        } else {
          result = await runTool(s, userId, def.name, parsed.data, { userId, conversationId: convId, services: s, signal: controller.signal }, action.summary);
        }
        s.actions.finish(action.id, result.isError ? "failed" : "executed", result.content);
        display = `✅ Aprobé la acción #${action.id}: ${action.summary}`;
        note = `El usuario APROBÓ la acción #${action.id} ("${action.summary}") mediante el botón de confirmación. El servidor la ejecutó. ${
          result.isError ? "Resultado: ERROR." : "Resultado: ÉXITO."
        }\n${wrapUntrusted(`resultado de ${action.tool_name}`, result.content, 8000)}`;
      } else {
        s.audit.record(userId, "user", "action.rejected", { actionId: action.id, tool: action.tool_name, summary: action.summary }, req.ip);
        display = `❌ Rechacé la acción #${action.id}: ${action.summary}`;
        note = `El usuario RECHAZÓ la acción #${action.id} ("${action.summary}"). No se ejecutó. No vuelvas a proponerla salvo que el usuario lo pida.`;
      }

      if (!convId || !s.conversations.get(userId, convId)) {
        return { ok: true, status: decision === "approve" ? "executed" : "rejected" };
      }
      appendUserTurn(s, userId, convId, {
        text: display,
        kind: "action_decision",
        clientTimezone: body.data.timezone,
        clientDevice: body.data.device,
        systemNote: note,
      });
      const conv = s.conversations.get(userId, convId)!;
      await streamTurn(req, reply, s, userId, convId, conv.title, controller);
    });
  }

  // ── Botón de emergencia ─────────────────────────────────
  app.post("/api/emergency-stop", async (req) => {
    const userId = req.user!.id;
    const turns = s.active.stopAll(userId);
    const actions = s.actions.rejectAll(userId);
    const devices = s.devices.stopAll(userId);
    s.audit.record(userId, "user", "emergency.stop", { turns, actions, devices }, req.ip);
    return { stoppedResponses: turns, rejectedActions: actions, devicesNotified: devices };
  });

  // ── Conversaciones ──────────────────────────────────────
  app.get<{ Querystring: { q?: string; projectId?: string } }>("/api/conversations", async (req) => {
    return {
      conversations: s.conversations.list(req.user!.id, {
        query: req.query.q?.slice(0, 200),
        projectId: req.query.projectId ? Number(req.query.projectId) : undefined,
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const conv = s.conversations.get(req.user!.id, id);
    if (!conv) return reply.code(404).send({ error: "Conversación no encontrada." });
    const pending = s.actions.list(req.user!.id, "pending").filter((a) => a.conversation_id === id);
    return {
      conversation: conv,
      messages: s.conversations.visibleMessages(req.user!.id, id),
      active: s.active.isActive(id),
      pendingActions: pending.map((a) => ({ id: a.id, tool: a.tool_name, label: s.tools.get(a.tool_name)?.label ?? a.tool_name, summary: a.summary })),
    };
  });

  const ConvPatch = z.object({ title: z.string().trim().min(1).max(120).optional(), projectId: Id.nullable().optional() });
  app.patch<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const body = ConvPatch.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (body.data.projectId && !s.memory.getProject(req.user!.id, body.data.projectId))
      return reply.code(400).send({ error: "Proyecto no encontrado." });
    const conv = s.conversations.update(req.user!.id, Number(req.params.id), body.data);
    return conv ? { conversation: conv } : reply.code(404).send({ error: "Conversación no encontrada." });
  });

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (s.active.isActive(id)) return reply.code(409).send({ error: "Detén la respuesta en curso antes de eliminar." });
    if (!s.conversations.remove(req.user!.id, id)) return reply.code(404).send({ error: "Conversación no encontrada." });
    s.audit.record(req.user!.id, "user", "conversation.deleted", { conversationId: id }, req.ip);
    return { ok: true };
  });

  // ── Memoria ─────────────────────────────────────────────
  const MemBody = z.object({
    content: z.string().trim().min(1).max(4000),
    category: z.enum(MEMORY_CATEGORIES).optional(),
    projectId: Id.nullable().optional(),
    pinned: z.boolean().optional(),
  });

  app.get<{ Querystring: { q?: string; category?: string; projectId?: string } }>("/api/memories", async (req) => ({
    memories: s.memory.list(req.user!.id, {
      query: req.query.q?.slice(0, 200),
      category: req.query.category,
      projectId: req.query.projectId ? Number(req.query.projectId) : undefined,
    }),
    categories: MEMORY_CATEGORIES,
  }));

  app.post("/api/memories", async (req, reply) => {
    const body = MemBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    try {
      const m = s.memory.create(req.user!.id, { ...body.data, source: "user" });
      s.audit.record(req.user!.id, "user", "memory.created", { id: m.id }, req.ip);
      return { memory: m };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/memories/:id", async (req, reply) => {
    const body = MemBody.partial().safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    try {
      const m = s.memory.update(req.user!.id, Number(req.params.id), body.data);
      if (!m) return reply.code(404).send({ error: "Recuerdo no encontrado." });
      s.audit.record(req.user!.id, "user", "memory.updated", { id: m.id }, req.ip);
      return { memory: m };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/memories/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!s.memory.remove(req.user!.id, id)) return reply.code(404).send({ error: "Recuerdo no encontrado." });
    s.audit.record(req.user!.id, "user", "memory.deleted", { id }, req.ip);
    return { ok: true };
  });

  // ── Proyectos ───────────────────────────────────────────
  const ProjBody = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000).optional(),
    status: z.enum(["active", "archived"]).optional(),
  });

  app.get<{ Querystring: { all?: string } }>("/api/projects", async (req) => ({
    projects: s.memory.listProjects(req.user!.id, req.query.all === "1"),
  }));

  app.post("/api/projects", async (req, reply) => {
    const body = ProjBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (s.memory.findProjectByName(req.user!.id, body.data.name)) return reply.code(409).send({ error: "Ya existe un proyecto con ese nombre." });
    return { project: s.memory.createProject(req.user!.id, body.data) };
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const body = ProjBody.partial().safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const p = s.memory.updateProject(req.user!.id, Number(req.params.id), body.data);
    return p ? { project: p } : reply.code(404).send({ error: "Proyecto no encontrado." });
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!s.memory.removeProject(req.user!.id, id)) return reply.code(404).send({ error: "Proyecto no encontrado." });
    s.audit.record(req.user!.id, "user", "project.deleted", { id }, req.ip);
    return { ok: true };
  });

  // ── Tareas ──────────────────────────────────────────────
  const TaskBody = z.object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(4000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    dueAt: z.string().max(40).nullable().optional(),
    projectId: Id.nullable().optional(),
  });

  app.get<{ Querystring: { status?: string; projectId?: string } }>("/api/tasks", async (req) => {
    const st = req.query.status;
    const status = st === "open" || (TASK_STATUSES as readonly string[]).includes(st ?? "") ? (st as "open") : undefined;
    return { tasks: s.tasks.list(req.user!.id, { status, projectId: req.query.projectId ? Number(req.query.projectId) : undefined }) };
  });

  app.post("/api/tasks", async (req, reply) => {
    const body = TaskBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const t = s.tasks.create(req.user!.id, body.data);
    if (body.data.status && body.data.status !== "pending") s.tasks.update(req.user!.id, t.id, { status: body.data.status });
    return { task: s.tasks.get(req.user!.id, t.id) };
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const body = TaskBody.partial().safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const t = s.tasks.update(req.user!.id, Number(req.params.id), body.data);
    return t ? { task: t } : reply.code(404).send({ error: "Tarea no encontrada." });
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    if (!s.tasks.remove(req.user!.id, Number(req.params.id))) return reply.code(404).send({ error: "Tarea no encontrada." });
    return { ok: true };
  });

  // ── Dispositivos ────────────────────────────────────────
  app.get("/api/devices", async (req) => ({ devices: s.devices.list(req.user!.id) }));

  app.post("/api/devices", async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(["windows"]).optional() }).safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const { device, token } = s.devices.create(req.user!.id, body.data.name, body.data.kind);
    s.audit.record(req.user!.id, "user", "device.created", { id: device.id, name: device.name }, req.ip);
    // El token se muestra UNA sola vez; en la base de datos sólo queda su hash.
    return { device, token };
  });

  app.delete<{ Params: { id: string } }>("/api/devices/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!s.devices.revoke(req.user!.id, id)) return reply.code(404).send({ error: "Dispositivo no encontrado." });
    s.audit.record(req.user!.id, "user", "device.revoked", { id }, req.ip);
    return { ok: true };
  });

  // ── Configuración ───────────────────────────────────────
  app.get("/api/settings", async (req) => {
    const settings = s.settings.get(req.user!.id);
    const resolved = s.providers.resolve(settings.model);
    return {
      settings,
      models: s.providers.knownModels(),
      ai: { configured: s.providers.hasRealProvider(), effectiveModel: resolved.model, demo: resolved.demo },
      efforts: EFFORTS,
      tools: s.tools.all().map((t) => ({
        name: t.name,
        label: t.label,
        module: t.module,
        description: t.description,
        sensitive: t.sensitive,
        defaultPermission: t.defaultPermission,
        permission: s.tools.permission(t.name, settings),
      })),
    };
  });

  const SettingsPatch = z.object({
    model: z.string().max(100).optional(),
    effort: z.enum(EFFORTS).optional(),
    userName: z.string().trim().max(60).optional(),
    timezone: z.string().trim().max(60).optional(),
    toolPermissions: z.record(z.string().max(60), z.enum(PERMISSION_MODES)).optional(),
  });

  app.patch("/api/settings", async (req, reply) => {
    const body = SettingsPatch.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const patch = body.data;
    if (patch.model && !s.providers.availableModels().some((m) => m.id === patch.model))
      return reply.code(400).send({ error: "Ese modelo no está disponible (¿falta la API key del proveedor?)." });
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat("es", { timeZone: patch.timezone });
      } catch {
        return reply.code(400).send({ error: "Zona horaria inválida." });
      }
    }
    if (patch.toolPermissions) {
      for (const [name, mode] of Object.entries(patch.toolPermissions)) {
        const t = s.tools.get(name);
        if (!t) return reply.code(400).send({ error: `Herramienta desconocida: ${name}` });
        if (t.sensitive && mode === "auto")
          return reply.code(400).send({ error: `"${t.label}" es una acción sensible: siempre requiere confirmación.` });
      }
    }
    const updated = s.settings.update(req.user!.id, patch);
    s.audit.record(req.user!.id, "user", "settings.updated", { keys: Object.keys(patch) }, req.ip);
    return { settings: updated };
  });

  // ── Registro de operaciones ─────────────────────────────
  app.get<{ Querystring: { before?: string } }>("/api/audit", async (req) => ({
    entries: s.audit.list(req.user!.id, 100, req.query.before ? Number(req.query.before) : undefined),
  }));
}

async function streamTurn(
  req: FastifyRequest,
  reply: FastifyReply,
  s: Services,
  userId: number,
  conversationId: number,
  title: string,
  controller: AbortController,
) {
  const sse = openSse(req, reply, controller);
  const emit = (e: ChatEvent) => sse.send(e);
  try {
    emit({ type: "conversation", id: conversationId, title });
    await runAssistantTurn(s, userId, conversationId, emit, controller.signal);
  } catch (err) {
    if (err instanceof ProviderError) {
      emit({ type: "error", message: err.userMessage, code: err.code });
    } else {
      req.log.error({ err }, "chat turn failed");
      emit({ type: "error", message: "Ocurrió un error interno al procesar la respuesta." });
    }
    s.conversations.append(conversationId, {
      role: "assistant",
      kind: "notice",
      apiContent: [],
      displayText: `⚠️ ${err instanceof ProviderError ? err.userMessage : "Error interno al procesar la respuesta."}`,
    });
  } finally {
    s.active.end(conversationId, controller);
    emit({ type: "status", state: "idle" });
    sse.end();
  }
}
