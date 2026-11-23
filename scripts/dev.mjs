// Modo desarrollo: arranca el cerebro central y la interfaz con recarga automática.
import { spawn } from "node:child_process";
import "./check-node.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const procs = ["server", "web"].map((ws) =>
  spawn(npm, ["run", "dev", "--workspace", ws], { stdio: "inherit", shell: process.platform === "win32" }),
);
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => { if (code) { stop(); process.exit(code); } }));
