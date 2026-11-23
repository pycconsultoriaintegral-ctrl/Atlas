import { z } from "zod";
import type { PermissionMode, UserSettings } from "../settings/settings.js";
import { deviceStatus } from "./builtin/deviceTools.js";
import {
  conversationSearch,
  memoryDelete,
  memorySave,
  memorySearch,
  memoryUpdate,
  projectCreate,
  projectList,
} from "./builtin/memoryTools.js";
import { taskCreate, taskList, taskUpdate } from "./builtin/taskTools.js";
import type { ToolDefinition } from "./types.js";

/** Formato neutral de herramienta que se entrega al proveedor de IA. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; [k: string]: unknown };
}

/**
 * Módulos activos. Fases siguientes añadirán aquí: voz, archivos, Windows,
 * visión, Excel, PDF, Word, web, calendario, correo, finanzas…
 */
const BUILTIN: ToolDefinition[] = [
  memorySave,
  memorySearch,
  memoryUpdate,
  memoryDelete,
  projectCreate,
  projectList,
  conversationSearch,
  taskCreate,
  taskList,
  taskUpdate,
  deviceStatus,
];

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor(defs: ToolDefinition[] = BUILTIN) {
    for (const d of defs) this.tools.set(d.name, d);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  all(): ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Definiciones para la IA, en orden determinista. Se "congelan" por conversación
   * para mantener estable el prefijo de la conversación (caché y razonamiento).
   */
  specs(): ToolSpec[] {
    return this.all().map((t) => {
      const schema = z.toJSONSchema(t.schema, { target: "draft-2020-12" }) as Record<string, unknown>;
      delete schema.$schema;
      return { name: t.name, description: t.description, input_schema: { ...schema, type: "object" } };
    });
  }

  /** Permiso efectivo: las herramientas sensibles nunca pueden quedar en "auto". */
  permission(name: string, settings: UserSettings): PermissionMode {
    const t = this.tools.get(name);
    if (!t) return "disabled";
    const chosen = settings.toolPermissions[name] ?? t.defaultPermission;
    if (t.sensitive && chosen === "auto") return "confirm";
    return chosen;
  }
}
