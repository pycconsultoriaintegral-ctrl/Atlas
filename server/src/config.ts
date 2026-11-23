import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Raíz del repositorio (server/src/.. /..). */
export const REPO_ROOT = path.resolve(here, "..", "..");

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  /** ":memory:" en pruebas. */
  dbFile: string;
  anthropicApiKey: string | undefined;
  defaultModel: string;
  setupCode: string | undefined;
  webDistDir: string;
  /** Proveedor forzado (p. ej. "mock" en pruebas). */
  forceProvider: string | undefined;
  isTest: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const dataDir = path.resolve(REPO_ROOT, env.ATLAS_DATA_DIR || "./data");
  const base: AppConfig = {
    port: Number(env.PORT || 8787),
    host: env.HOST || "127.0.0.1",
    dataDir,
    dbFile: path.join(dataDir, "atlas.db"),
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    defaultModel: env.ATLAS_DEFAULT_MODEL?.trim() || "claude-opus-5-5",
    setupCode: env.ATLAS_SETUP_CODE?.trim() || undefined,
    webDistDir: path.join(REPO_ROOT, "web", "dist"),
    forceProvider: env.ATLAS_FORCE_PROVIDER?.trim() || undefined,
    isTest: env.NODE_ENV === "test" || !!env.VITEST,
  };
  return { ...base, ...overrides };
}
