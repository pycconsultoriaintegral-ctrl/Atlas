import { afterEach, describe, expect, it } from "vitest";
import { H, makeApp, parseSse, setupUser } from "./helpers.js";

let built: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => built?.app.close());

async function chat(cookie: string, message: string, conversationId?: number) {
  const res = await built.app.inject({
    method: "POST",
    url: "/api/chat",
    headers: { ...H, cookie },
    payload: { message, conversationId, timezone: "America/Santiago", device: "Prueba" },
  });
  expect(res.statusCode).toBe(200);
  return parseSse(res.body);
}

describe("chat con el proveedor de demostración", () => {
  it("responde en streaming, crea la conversación y guarda el historial", async () => {
    built = await makeApp();
    const cookie = await setupUser(built.app);
    const events = await chat(cookie, "Hola ATLAS");
    const conv = events.find((e) => e.type === "conversation")!;
    expect(conv.title).toBe("Hola ATLAS");
    expect(events.some((e) => e.type === "notice" && /demostración/i.test(e.message))).toBe(true);
    const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
    expect(text).toContain("Hola ATLAS");
    expect(events.at(-2)?.type).toBe("done");

    const detail = (await built.app.inject({ method: "GET", url: `/api/conversations/${conv.id}`, headers: { cookie } })).json();
    expect(detail.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);

    // El historial enviado a la IA incluye el contexto del turno como mensaje de sistema.
    const history = built.services.conversations.apiHistory(conv.id);
    expect(history.map((m) => m.role)).toEqual(["user", "system", "assistant"]);
    expect(JSON.stringify(history[1])).toContain("<atlas_context>");
    expect(JSON.stringify(history[1])).toContain("zona horaria America/Santiago");
  });

  it("usa herramientas: guarda un recuerdo y lo pone en el contexto del siguiente turno", async () => {
    built = await makeApp();
    const cookie = await setupUser(built.app);
    const events = await chat(cookie, "Recuerda que mi empresa se llama PYC Consultoría");
    expect(events.some((e) => e.type === "tool" && e.name === "memory_save" && e.status === "ok")).toBe(true);
    const mems = (await built.app.inject({ method: "GET", url: "/api/memories", headers: { cookie } })).json().memories;
    expect(mems).toHaveLength(1);
    expect(mems[0].content).toContain("PYC Consultoría");

    const convId = events.find((e) => e.type === "conversation")!.id;
    await chat(cookie, "¿Cómo se llama mi empresa?", convId);
    const history = built.services.conversations.apiHistory(convId);
    const lastContext = history.filter((m) => m.role === "system").at(-1);
    expect(JSON.stringify(lastContext)).toContain("PYC Consultoría");
    // Cada llamada a herramienta tiene su resultado inmediatamente después.
    const roles = history.map((m) => m.role);
    expect(roles).toEqual(["user", "system", "assistant", "user", "assistant", "user", "system", "assistant"]);
  });

  it("pide confirmación para acciones sensibles y no las ejecuta sin aprobación", async () => {
    built = await makeApp();
    const cookie = await setupUser(built.app);
    const mem = (
      await built.app.inject({ method: "POST", url: "/api/memories", headers: { ...H, cookie }, payload: { content: "Dato temporal" } })
    ).json().memory;

    const events = await chat(cookie, `Borra el recuerdo #${mem.id}`);
    const confirmation = events.find((e) => e.type === "confirmation")!;
    expect(confirmation).toBeTruthy();
    // Todavía existe: no se borró sin permiso.
    expect((await built.app.inject({ method: "GET", url: "/api/memories", headers: { cookie } })).json().memories).toHaveLength(1);

    const approve = await built.app.inject({
      method: "POST",
      url: `/api/actions/${confirmation.actionId}/approve`,
      headers: { ...H, cookie },
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    const after = parseSse(approve.body);
    expect(after.some((e) => e.type === "done")).toBe(true);
    expect((await built.app.inject({ method: "GET", url: "/api/memories", headers: { cookie } })).json().memories).toHaveLength(0);

    // No se puede aprobar dos veces.
    const again = await built.app.inject({ method: "POST", url: `/api/actions/${confirmation.actionId}/approve`, headers: { ...H, cookie }, payload: {} });
    expect(again.statusCode).toBe(409);

    const audit = (await built.app.inject({ method: "GET", url: "/api/audit", headers: { cookie } })).json().entries.map((e: any) => e.action);
    expect(audit).toEqual(expect.arrayContaining(["action.requested", "action.approved", "tool.executed"]));
  });

  it("rechazar una acción no la ejecuta", async () => {
    built = await makeApp();
    const cookie = await setupUser(built.app);
    const mem = (
      await built.app.inject({ method: "POST", url: "/api/memories", headers: { ...H, cookie }, payload: { content: "Importante" } })
    ).json().memory;
    const events = await chat(cookie, `Elimina el recuerdo ${mem.id}`);
    const { actionId } = events.find((e) => e.type === "confirmation")!;
    const res = await built.app.inject({ method: "POST", url: `/api/actions/${actionId}/reject`, headers: { ...H, cookie }, payload: {} });
    expect(res.statusCode).toBe(200);
    expect((await built.app.inject({ method: "GET", url: "/api/memories", headers: { cookie } })).json().memories).toHaveLength(1);
  });

  it("las herramientas sensibles no pueden configurarse en automático; las desactivadas no se ejecutan", async () => {
    built = await makeApp();
    const cookie = await setupUser(built.app);
    let res = await built.app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { ...H, cookie },
      payload: { toolPermissions: { memory_delete: "auto" } },
    });
    expect(res.statusCode).toBe(400);
    res = await built.app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { ...H, cookie },
      payload: { toolPermissions: { memory_save: "disabled" } },
    });
    expect(res.statusCode).toBe(200);
    const events = await chat(cookie, "Recuerda que no debo guardarse");
    expect(events.some((e) => e.type === "tool" && e.status === "disabled")).toBe(true);
    expect((await built.app.inject({ method: "GET", url: "/api/memories", headers: { cookie } })).json().memories).toHaveLength(0);
  });

  it("informa con honestidad que no hay computador conectado", async () => {
    built = await makeApp();
    const cookie = await setupUser(built.app);
    const events = await chat(cookie, "¿Está conectado mi computador?");
    const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
    expect(text).toMatch(/No hay dispositivos vinculados/);
  });

  it("el botón de emergencia detiene respuestas y rechaza acciones pendientes", async () => {
    built = await makeApp();
    const cookie = await setupUser(built.app);
    const mem = (await built.app.inject({ method: "POST", url: "/api/memories", headers: { ...H, cookie }, payload: { content: "x y z" } })).json()
      .memory;
    await chat(cookie, `borra el recuerdo #${mem.id}`);
    const res = await built.app.inject({ method: "POST", url: "/api/emergency-stop", headers: { ...H, cookie } });
    expect(res.json().rejectedActions).toBe(1);
    const pending = (await built.app.inject({ method: "GET", url: "/api/actions?status=pending", headers: { cookie } })).json().actions;
    expect(pending).toHaveLength(0);
  });
});
