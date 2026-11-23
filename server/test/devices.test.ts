import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { H, makeApp, setupUser } from "./helpers.js";

let built: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => built?.app.close());

function connect(url: string, token?: string) {
  return new WebSocket(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
}

const waitFor = async (fn: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("dispositivos (base del agente de Windows)", () => {
  it("rechaza agentes sin token y gestiona estado, órdenes y parada de emergencia", async () => {
    built = await makeApp();
    const { app, services } = built;
    const cookie = await setupUser(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws/agent`;

    // Sin token → se cierra con 4401.
    const anon = connect(url);
    const code = await new Promise<number>((r) => anon.on("close", (c) => r(c)));
    expect(code).toBe(4401);

    const created = (
      await app.inject({ method: "POST", url: "/api/devices", headers: { ...H, cookie }, payload: { name: "PC Oficina" } })
    ).json();
    expect(created.token).toMatch(/^atlasdev_/);

    const ws = connect(url, created.token);
    const received: any[] = [];
    ws.on("message", (m) => received.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "hello", version: "0.1.0", hostname: "OFICINA-PC" }));
    ws.send(JSON.stringify({ type: "status", state: "busy", task: "Abriendo Excel" }));

    await waitFor(() => services.devices.list(1)[0]!.state === "busy");
    const dev = (await app.inject({ method: "GET", url: "/api/devices", headers: { cookie } })).json().devices[0];
    expect(dev).toMatchObject({ name: "PC Oficina", state: "busy", currentTask: "Abriendo Excel", hostname: "OFICINA-PC" });

    // Orden → resultado.
    const pending = services.devices.sendCommand(1, dev.id, "ping", {});
    await waitFor(() => received.some((m) => m.type === "command"));
    const cmd = received.find((m) => m.type === "command");
    ws.send(JSON.stringify({ type: "result", commandId: cmd.id, ok: true, output: "pong" }));
    expect(await pending).toEqual({ ok: true, output: "pong", error: undefined });

    // Emergencia → el agente recibe "stop".
    await app.inject({ method: "POST", url: "/api/emergency-stop", headers: { ...H, cookie } });
    await waitFor(() => received.some((m) => m.type === "stop"));

    // Revocar → se desconecta y el token deja de servir.
    await app.inject({ method: "DELETE", url: `/api/devices/${dev.id}`, headers: { ...H, cookie } });
    await new Promise((r) => ws.on("close", r));
    const again = connect(url, created.token);
    expect(await new Promise<number>((r) => again.on("close", (c) => r(c)))).toBe(4401);
  });
});
