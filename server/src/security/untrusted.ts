/**
 * Protección contra "prompt injection".
 *
 * Todo contenido que NO escribió el usuario (archivos, PDFs, páginas web, salida
 * de programas, resultados del agente de Windows…) se envuelve en una etiqueta
 * <untrusted_content>. Las instrucciones del sistema le indican a ATLAS que ese
 * contenido son DATOS, nunca órdenes. Además, las herramientas sensibles requieren
 * confirmación del usuario en el servidor, independientemente de lo que diga la IA.
 */
export function wrapUntrusted(source: string, content: string, maxChars = 60_000): string {
  const safeSource = source.replace(/["<>\n\r]/g, " ").slice(0, 200);
  // Evita que el contenido "cierre" la etiqueta y se haga pasar por el sistema.
  const neutralized = content
    .slice(0, maxChars)
    .replace(/<\/?\s*untrusted_content[^>]*>/gi, "[etiqueta eliminada]")
    .replace(/<\/?\s*(system|atlas_context|instructions?)\s*>/gi, "[etiqueta eliminada]");
  const truncated = content.length > maxChars ? `\n[… contenido truncado: ${content.length - maxChars} caracteres más]` : "";
  return `<untrusted_content source="${safeSource}">\n${neutralized}${truncated}\n</untrusted_content>`;
}
