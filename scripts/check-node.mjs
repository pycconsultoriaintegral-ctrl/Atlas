// Verifica que la versión de Node.js sea compatible (SQLite integrado: Node 22.13 o superior).
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n✖ ATLAS necesita Node.js 22.13 o superior (tienes ${process.versions.node}).`);
  console.error("  Descarga la versión LTS desde https://nodejs.org e instálala.\n");
  process.exit(1);
}
