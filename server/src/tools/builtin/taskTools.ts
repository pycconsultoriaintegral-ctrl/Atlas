import { z } from "zod";
import { TASK_STATUSES } from "../../tasks/taskRepo.js";
import { defineTool } from "../types.js";

const STATUS_ES: Record<string, string> = {
  pending: "pendiente",
  in_progress: "en curso",
  done: "hecha",
  cancelled: "cancelada",
};

export const taskCreate = defineTool({
  name: "task_create",
  module: "Tareas",
  label: "Crear una tarea",
  description: "Crea una tarea/pendiente para el usuario. due_at en formato ISO 8601 (fecha u hora local) si el usuario indicó un plazo.",
  schema: z.object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    due_at: z.string().max(40).optional().describe("Fecha límite ISO 8601, p. ej. 2026-11-30 o 2026-11-30T15:00"),
    project: z.string().max(100).optional().describe("Nombre de un proyecto existente"),
  }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: (i) => `Crear la tarea "${i.title}"`,
  async run(i, ctx) {
    let projectId: number | null = null;
    if (i.project) {
      const p = ctx.services.memory.findProjectByName(ctx.userId, i.project);
      if (!p) return { content: `No existe el proyecto "${i.project}".`, isError: true };
      projectId = p.id;
    }
    const t = ctx.services.tasks.create(ctx.userId, { title: i.title, notes: i.notes, dueAt: i.due_at ?? null, projectId });
    return { content: `Tarea #${t.id} creada: "${t.title}"${t.due_at ? ` (vence ${t.due_at})` : ""}.` };
  },
});

export const taskList = defineTool({
  name: "task_list",
  module: "Tareas",
  label: "Listar tareas",
  description: "Lista las tareas del usuario. status 'open' = pendientes y en curso.",
  schema: z.object({
    status: z.enum([...TASK_STATUSES, "open"]).optional(),
    project: z.string().max(100).optional(),
  }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: () => "Consultar tareas",
  async run(i, ctx) {
    const projectId = i.project ? ctx.services.memory.findProjectByName(ctx.userId, i.project)?.id : undefined;
    const ts = ctx.services.tasks.list(ctx.userId, { status: i.status ?? "open", projectId, limit: 50 });
    if (!ts.length) return { content: "No hay tareas con ese criterio." };
    return {
      content: ts
        .map((t) => `#${t.id} [${STATUS_ES[t.status]}] ${t.title}${t.due_at ? ` (vence ${t.due_at})` : ""}${t.project_name ? ` · ${t.project_name}` : ""}`)
        .join("\n"),
    };
  },
});

export const taskUpdate = defineTool({
  name: "task_update",
  module: "Tareas",
  label: "Actualizar una tarea",
  description: "Cambia el estado, título, notas o fecha de una tarea existente (por id).",
  schema: z.object({
    id: z.number().int().positive(),
    status: z.enum(TASK_STATUSES).optional(),
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).optional(),
    due_at: z.string().max(40).nullable().optional(),
  }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: (i) => `Actualizar la tarea #${i.id}${i.status ? ` → ${STATUS_ES[i.status]}` : ""}`,
  async run(i, ctx) {
    const t = ctx.services.tasks.update(ctx.userId, i.id, { status: i.status, title: i.title, notes: i.notes, dueAt: i.due_at });
    return t
      ? { content: `Tarea #${t.id} actualizada: "${t.title}" [${STATUS_ES[t.status]}].` }
      : { content: `No existe la tarea #${i.id}.`, isError: true };
  },
});
