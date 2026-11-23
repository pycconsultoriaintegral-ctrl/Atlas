import { z } from "zod";
import { MEMORY_CATEGORIES } from "../../memory/memoryRepo.js";
import { defineTool, type ToolContext } from "../types.js";

const Category = z.enum(MEMORY_CATEGORIES);

function resolveProjectId(ctx: ToolContext, name?: string | null) {
  if (!name) return null;
  const p = ctx.services.memory.findProjectByName(ctx.userId, name);
  if (!p) throw new Error(`No existe un proyecto llamado "${name}". Créalo primero con project_create.`);
  return p.id;
}

export const memorySave = defineTool({
  name: "memory_save",
  module: "Memoria",
  label: "Guardar un recuerdo",
  description:
    "Guarda un dato en la memoria a largo plazo del usuario (compartida entre sus dispositivos). Úsala cuando el usuario pida expresamente recordar algo (\"recuerda que…\", \"anota…\", \"no olvides…\") o exprese una preferencia duradera sobre cómo quiere que trabajes. Nunca guardes contraseñas, claves, números de tarjeta ni datos bancarios.",
  schema: z.object({
    content: z.string().min(2).max(2000).describe("El dato a recordar, redactado de forma clara y autocontenida, en tercera persona."),
    category: Category.optional().describe("Categoría del recuerdo."),
    project: z.string().max(100).optional().describe("Nombre de un proyecto existente al que asociarlo (opcional)."),
    pinned: z.boolean().optional().describe("true si es algo esencial que ATLAS debe tener siempre presente."),
  }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: (i) => `Guardar en memoria: "${i.content.slice(0, 120)}"`,
  async run(i, ctx) {
    if (/\b(contraseña|password|clave\s+de\s+acceso|pin\s+bancario|cvv)\b/i.test(i.content) && /\d|[:=]/.test(i.content)) {
      return { content: "No se guardó: parece contener una contraseña o dato secreto. ATLAS no almacena secretos.", isError: true };
    }
    const m = ctx.services.memory.create(ctx.userId, {
      content: i.content,
      category: i.category,
      projectId: resolveProjectId(ctx, i.project),
      pinned: i.pinned,
      source: "atlas",
    });
    return { content: `Recuerdo #${m.id} guardado (${m.category}${m.project_name ? `, proyecto ${m.project_name}` : ""}).` };
  },
});

export const memorySearch = defineTool({
  name: "memory_search",
  module: "Memoria",
  label: "Buscar en la memoria",
  description: "Busca recuerdos guardados del usuario por palabras clave, categoría o proyecto. Devuelve id, categoría y contenido.",
  schema: z.object({
    query: z.string().max(300).optional().describe("Palabras clave. Vacío = los más recientes."),
    category: Category.optional(),
    project: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: (i) => `Buscar en memoria${i.query ? `: "${i.query}"` : ""}`,
  async run(i, ctx) {
    const projectId = i.project ? (resolveProjectId(ctx, i.project) ?? undefined) : undefined;
    const items = ctx.services.memory.list(ctx.userId, { query: i.query, category: i.category, projectId, limit: i.limit ?? 15 });
    if (!items.length) return { content: "No se encontraron recuerdos." };
    return {
      content: items
        .map((m) => `#${m.id} [${m.category}${m.project_name ? ` · ${m.project_name}` : ""}${m.pinned ? " · fijado" : ""}] ${m.content}`)
        .join("\n"),
    };
  },
});

export const memoryUpdate = defineTool({
  name: "memory_update",
  module: "Memoria",
  label: "Editar un recuerdo",
  description: "Modifica el contenido, la categoría o el fijado de un recuerdo existente (por id). Requiere confirmación del usuario.",
  schema: z.object({
    id: z.number().int().positive(),
    content: z.string().min(2).max(2000).optional(),
    category: Category.optional(),
    pinned: z.boolean().optional(),
  }),
  defaultPermission: "confirm",
  sensitive: false,
  summarize: (i, ctx) => {
    const m = ctx.services.memory.get(ctx.userId, i.id);
    return `Editar el recuerdo #${i.id}${m ? ` ("${m.content.slice(0, 80)}")` : ""}${i.content ? ` → "${i.content.slice(0, 80)}"` : ""}`;
  },
  async run(i, ctx) {
    const m = ctx.services.memory.update(ctx.userId, i.id, { content: i.content, category: i.category, pinned: i.pinned });
    return m ? { content: `Recuerdo #${m.id} actualizado.` } : { content: `No existe el recuerdo #${i.id}.`, isError: true };
  },
});

export const memoryDelete = defineTool({
  name: "memory_delete",
  module: "Memoria",
  label: "Eliminar un recuerdo",
  description: "Elimina definitivamente un recuerdo (por id). Acción destructiva: siempre requiere confirmación del usuario.",
  schema: z.object({ id: z.number().int().positive() }),
  defaultPermission: "confirm",
  sensitive: true,
  summarize: (i, ctx) => {
    const m = ctx.services.memory.get(ctx.userId, i.id);
    return `Eliminar definitivamente el recuerdo #${i.id}${m ? `: "${m.content.slice(0, 100)}"` : " (no encontrado)"}`;
  },
  async run(i, ctx) {
    return ctx.services.memory.remove(ctx.userId, i.id)
      ? { content: `Recuerdo #${i.id} eliminado.` }
      : { content: `No existe el recuerdo #${i.id}.`, isError: true };
  },
});

export const projectCreate = defineTool({
  name: "project_create",
  module: "Proyectos",
  label: "Crear un proyecto",
  description: "Crea un proyecto para agrupar recuerdos, tareas y conversaciones.",
  schema: z.object({ name: z.string().min(1).max(100), description: z.string().max(1000).optional() }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: (i) => `Crear el proyecto "${i.name}"`,
  async run(i, ctx) {
    const existing = ctx.services.memory.findProjectByName(ctx.userId, i.name);
    if (existing) return { content: `Ya existe el proyecto "${existing.name}" (#${existing.id}).` };
    const p = ctx.services.memory.createProject(ctx.userId, i);
    return { content: `Proyecto "${p.name}" creado (#${p.id}).` };
  },
});

export const projectList = defineTool({
  name: "project_list",
  module: "Proyectos",
  label: "Listar proyectos",
  description: "Lista los proyectos del usuario.",
  schema: z.object({ includeArchived: z.boolean().optional() }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: () => "Consultar proyectos",
  async run(i, ctx) {
    const ps = ctx.services.memory.listProjects(ctx.userId, i.includeArchived);
    if (!ps.length) return { content: "No hay proyectos." };
    return { content: ps.map((p) => `#${p.id} ${p.name} (${p.status})${p.description ? ` — ${p.description}` : ""}`).join("\n") };
  },
});

export const conversationSearch = defineTool({
  name: "conversation_search",
  module: "Memoria",
  label: "Buscar en conversaciones anteriores",
  description: "Busca un texto en las conversaciones anteriores del usuario. Devuelve fragmentos con fecha y título.",
  schema: z.object({ query: z.string().min(2).max(200), limit: z.number().int().min(1).max(20).optional() }),
  defaultPermission: "auto",
  sensitive: false,
  summarize: (i) => `Buscar "${i.query}" en conversaciones anteriores`,
  async run(i, ctx) {
    const hits = ctx.services.conversations.searchMessages(ctx.userId, i.query, i.limit ?? 8);
    if (!hits.length) return { content: "No se encontraron coincidencias en conversaciones anteriores." };
    return {
      content: hits.map((h) => `[${h.created_at} · "${h.title}" · ${h.role === "user" ? "usuario" : "ATLAS"}] ${h.snippet}`).join("\n"),
      untrusted: true,
      source: "historial de conversaciones",
    };
  },
});
