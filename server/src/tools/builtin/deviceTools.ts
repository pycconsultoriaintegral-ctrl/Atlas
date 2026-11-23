import { z } from "zod";
import { defineTool } from "../types.js";

const STATE_ES = { offline: "desconectado", online: "conectado y disponible", busy: "ocupado", error: "con error" } as const;

export const deviceStatus = defineTool({
  name: "device_status",
  module: "Dispositivos",
  label: "Estado de los dispositivos",
  description:
    "Consulta qué dispositivos del usuario (p. ej. su computador Windows con el agente ATLAS) están vinculados y si están conectados, ocupados o desconectados. Úsala antes de prometer cualquier acción en el computador.",
  schema: z.object({}),
  defaultPermission: "auto",
  sensitive: false,
  summarize: () => "Consultar el estado de los dispositivos",
  async run(_i, ctx) {
    const ds = ctx.services.devices.list(ctx.userId).filter((d) => !d.revoked);
    if (!ds.length) {
      return {
        content:
          "No hay dispositivos vinculados. El agente de Windows todavía no está instalado (llega en la Fase 3), así que ATLAS no puede ejecutar acciones en el computador.",
      };
    }
    return {
      content: ds
        .map(
          (d) =>
            `#${d.id} ${d.name} (${d.kind}): ${STATE_ES[d.state]}${d.currentTask ? ` — tarea: ${d.currentTask}` : ""}${d.last_seen_at ? ` · visto por última vez ${d.last_seen_at} UTC` : ""}`,
        )
        .join("\n"),
    };
  },
});
