import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

// Si nadie ha configurado ATLAS todavía, se necesita un código de configuración
// inicial. Así, aunque alguien llegue a la página antes que tú, no podrá
// apropiarse de tu asistente sin acceso a esta consola.
const { app, services } = await buildApp({ ...config, setupCode: config.setupCode });
const needsSetup = (services.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0;
if (needsSetup && !config.setupCode) {
  const code = crypto.randomInt(100000, 999999).toString();
  services.config.setupCode = code;
  const file = path.join(config.dataDir, "CODIGO-DE-CONFIGURACION.txt");
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, `Código de configuración inicial de ATLAS: ${code}\n(Este archivo se puede borrar después de crear tu cuenta.)\n`);
}

await app.listen({ port: config.port, host: config.host });

const url = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
const line = "═".repeat(62);
console.log(`\n${line}`);
console.log("  ATLAS — cerebro central en línea");
console.log(`  Abre en el navegador:  ${url}`);
console.log(`  IA: ${services.providers.hasRealProvider() ? "Anthropic Claude ✔" : "MODO DEMOSTRACIÓN (falta ANTHROPIC_API_KEY en .env)"}`);
if (needsSetup) {
  console.log(`\n  PRIMER USO → código de configuración:  ${services.config.setupCode}`);
  console.log("  (también guardado en data/CODIGO-DE-CONFIGURACION.txt)");
}
console.log(`${line}\n`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
