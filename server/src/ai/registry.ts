import type { AppConfig } from "../config.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { MOCK_MODEL, MockProvider } from "./mockProvider.js";
import type { AIProvider, ModelInfo } from "./types.js";

/**
 * Registro de proveedores de IA. Para añadir OpenAI u otro proveedor:
 *   1. Crea ai/openaiProvider.ts implementando la interfaz AIProvider
 *      (convertir el historial canónico ↔ formato del proveedor).
 *   2. Agrégalo a la lista `providers` de abajo, leyendo su clave desde .env.
 * El resto de ATLAS (memoria, herramientas, seguridad, interfaz) no cambia.
 */
export class ProviderRegistry {
  private providers: AIProvider[];
  private mock = new MockProvider();

  constructor(private config: AppConfig) {
    this.providers = [new AnthropicProvider(config.anthropicApiKey)];
  }

  /** ¿Hay al menos un proveedor real configurado? */
  hasRealProvider(): boolean {
    return !this.config.forceProvider && this.providers.some((p) => p.configured());
  }

  /** Modelos disponibles para elegir en Configuración. */
  availableModels(): ModelInfo[] {
    const real = this.config.forceProvider ? [] : this.providers.filter((p) => p.configured()).flatMap((p) => p.models());
    return real.length ? real : [MOCK_MODEL];
  }

  /** Todos los modelos conocidos (incluye los de proveedores sin configurar). */
  knownModels(): Array<ModelInfo & { available: boolean }> {
    const avail = new Set(this.availableModels().map((m) => m.id));
    return [...this.providers.flatMap((p) => p.models()), MOCK_MODEL].map((m) => ({ ...m, available: avail.has(m.id) }));
  }

  /**
   * Elige proveedor y modelo. Si el modelo pedido no está disponible (p. ej. falta
   * la API key), se usa el modo demostración y se avisa claramente.
   */
  resolve(modelId: string): { provider: AIProvider; model: string; demo: boolean } {
    if (this.config.forceProvider === "mock") return { provider: this.mock, model: MOCK_MODEL.id, demo: true };
    for (const p of this.providers) {
      if (p.configured() && p.models().some((m) => m.id === modelId)) return { provider: p, model: modelId, demo: false };
    }
    const firstReal = this.providers.find((p) => p.configured());
    if (firstReal) return { provider: firstReal, model: firstReal.models()[0]!.id, demo: false };
    return { provider: this.mock, model: MOCK_MODEL.id, demo: true };
  }
}
