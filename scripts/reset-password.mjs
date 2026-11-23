// Restablece la contraseña de ATLAS desde este computador (sin perder datos).
// Uso:  npm run reset-password
// Sólo funciona con acceso local a la carpeta de ATLAS, por eso es seguro.
import crypto from "node:crypto";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import "./check-node.mjs";

const { DatabaseSync } = await import("node:sqlite");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(root, process.env.ATLAS_DATA_DIR || "./data");
const db = new DatabaseSync(path.join(dataDir, "atlas.db"));

const users = db.prepare("SELECT id, username FROM users").all();
if (!users.length) {
  console.log("Todavía no hay cuenta creada. Abre ATLAS y usa el código de configuración.");
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Usuario: ${users[0].username}`);
const pw = await rl.question("Nueva contraseña (mín. 10 caracteres, letras y números): ");
rl.close();
if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
  console.error("La contraseña no cumple los requisitos. No se cambió nada.");
  process.exit(1);
}
const N = 2 ** 15, r = 8, p = 1;
const salt = crypto.randomBytes(16);
const hash = await promisify(crypto.scrypt)(pw.normalize("NFKC"), salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
  `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`,
  users[0].id,
);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(users[0].id);
db.prepare("INSERT INTO audit_log (user_id, actor, action, detail) VALUES (?, 'system', 'auth.password_reset_local', '{}')").run(users[0].id);
console.log("✔ Contraseña actualizada. Se cerraron todas las sesiones; vuelve a iniciar sesión.");
