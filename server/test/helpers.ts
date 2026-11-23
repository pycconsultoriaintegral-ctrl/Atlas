import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

export const PASSWORD = "Atlas-Prueba-2026";
export const SETUP_CODE = "123456";

export async function makeApp(overrides: Parameters<typeof loadConfig>[0] = {}) {
  const config = loadConfig({
    dbFile: ":memory:",
    forceProvider: "mock",
    setupCode: SETUP_CODE,
    isTest: true,
    webDistDir: "/nonexistent",
    anthropicApiKey: undefined,
    ...overrides,
  });
  return buildApp(config);
}

export const H = { "x-atlas-request": "1", "content-type": "application/json" };

/** Crea la cuenta y devuelve la cookie de sesión. */
export async function setupUser(app: Awaited<ReturnType<typeof makeApp>>["app"]) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers: H,
    payload: { setupCode: SETUP_CODE, username: "jefe", password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "atlas_session")!;
  return `atlas_session=${cookie.value}`;
}

export function parseSse(body: string): Array<{ type: string; [k: string]: any }> {
  return body
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(6)));
}
