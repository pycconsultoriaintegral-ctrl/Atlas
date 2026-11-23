import type { z } from "zod";
import type { PermissionMode } from "../settings/settings.js";
import type { Services } from "../services.js";

/**
 * Contrato de una herramienta de ATLAS.
 *
 * Para añadir un módulo nuevo (Excel, PDF, Windows, Calendario…) basta con crear
 * un archivo en tools/builtin/ que exporte herramientas con esta forma y
 * registrarlo en tools/registry.ts. La seguridad (permisos, confirmación,
 * auditoría) la aplica el servidor de forma centralizada, no la IA.
 */
export interface ToolContext {
  userId: number;
  conversationId: number | null;
  services: Services;
  signal: AbortSignal;
}

export interface ToolOutput {
  /** Texto que verá la IA como resultado. */
  content: string;
  isError?: boolean;
  /** true si el resultado contiene datos externos (archivos, web…) no escritos por el usuario. */
  untrusted?: boolean;
  /** Origen del contenido no confiable (para la etiqueta). */
  source?: string;
}

export interface ToolDefinition<I = any> {
  name: string;
  /** Módulo al que pertenece (para la interfaz de Configuración). */
  module: string;
  /** Nombre legible en español. */
  label: string;
  description: string;
  schema: z.ZodType<I>;
  /** Permiso por defecto. */
  defaultPermission: PermissionMode;
  /**
   * Herramienta sensible (borra, envía, compra, modifica el computador…):
   * NUNCA puede configurarse en "auto"; siempre exige confirmación explícita.
   */
  sensitive: boolean;
  /** Describe en lenguaje humano lo que hará (se muestra al pedir confirmación). */
  summarize(input: I, ctx: ToolContext): string;
  run(input: I, ctx: ToolContext): Promise<ToolOutput>;
}

export function defineTool<I>(def: ToolDefinition<I>): ToolDefinition<I> {
  return def;
}
