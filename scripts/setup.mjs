// Preparación inicial: crea el archivo .env a partir de .env.example (si no existe).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./check-node.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = path.join(root, ".env");
if (fs.existsSync(env)) {
  console.log("✔ Ya existe el archivo .env (no se modificó).");
} else {
  fs.copyFileSync(path.join(root, ".env.example"), env);
  console.log("✔ Se creó el archivo .env.");
  console.log("  Ábrelo con el Bloc de notas y pega tu API key de Anthropic en ANTHROPIC_API_KEY=");
  console.log("  (si lo dejas vacío, ATLAS arrancará en modo demostración).");
}
