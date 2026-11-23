import { afterEach, describe, expect, it } from "vitest";
import { H, makeApp, PASSWORD, SETUP_CODE, setupUser } from "./helpers.js";

let built: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => built?.app.close());

describe("autenticación", () => {
  it("exige configuración inicial con código y luego permite iniciar sesión", async () => {
    built = await makeApp();
    const { app } = built;
    let res = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(res.json()).toEqual({ setupRequired: true, user: null });

    res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: H,
      payload: { setupCode: "000000", username: "jefe", password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);

    res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: H,
      payload: { setupCode: SETUP_CODE, username: "jefe", password: "corta" },
    });
    expect(res.statusCode).toBe(400);

    const cookie = await setupUser(app);
    res = await app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
    expect(res.json().user.username).toBe("jefe");

    // No se puede volver a configurar.
    res = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: H,
      payload: { setupCode: SETUP_CODE, username: "otro", password: PASSWORD },
    });
    expect(res.statusCode).toBe(409);

    res = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { username: "jefe", password: "mal-1234567" } });
    expect(res.statusCode).toBe(401);
    res = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { username: "JEFE", password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c) => c.name === "atlas_session")!;
    expect(sessionCookie.httpOnly).toBe(true);
    expect(sessionCookie.sameSite).toBe("Strict");
  });

  it("bloquea la API sin sesión y sin cabecera anti-CSRF", async () => {
    built = await makeApp();
    const { app } = built;
    const cookie = await setupUser(app);
    expect((await app.inject({ method: "GET", url: "/api/memories" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/memories", headers: { cookie: "atlas_session=falso" } })).statusCode).toBe(401);
    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/memories",
      headers: { cookie, "content-type": "application/json" },
      payload: { content: "x" },
    });
    expect(noCsrf.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: "/api/memories", headers: { ...H, cookie }, payload: { content: "Me gusta el café" } });
    expect(ok.statusCode).toBe(200);
  });

  it("bloquea temporalmente tras varios intentos fallidos", async () => {
    built = await makeApp();
    const { app } = built;
    await setupUser(app);
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { username: "jefe", password: `incorrecta${i}x` } }))
        .statusCode;
    }
    expect(last).toBe(429);
    // Incluso con la contraseña correcta, sigue bloqueado durante la espera.
    const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { username: "jefe", password: PASSWORD } });
    expect(res.statusCode).toBe(429);
  });

  it("cerrar sesión invalida el token y se pueden revocar otras sesiones", async () => {
    built = await makeApp();
    const { app } = built;
    const cookie = await setupUser(app);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { username: "jefe", password: PASSWORD } });
    const other = `atlas_session=${login.cookies.find((c) => c.name === "atlas_session")!.value}`;
    const list = await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie } });
    expect(list.json().sessions).toHaveLength(2);
    await app.inject({ method: "POST", url: "/api/auth/sessions/revoke-others", headers: { ...H, cookie } });
    expect((await app.inject({ method: "GET", url: "/api/memories", headers: { cookie: other } })).statusCode).toBe(401);
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { ...H, cookie } });
    expect((await app.inject({ method: "GET", url: "/api/memories", headers: { cookie } })).statusCode).toBe(401);
  });
});

describe("rutas protegidas", () => {
  it("todas las rutas de la API (excepto auth y health) exigen sesión", async () => {
    built = await makeApp();
    const { app } = built;
    await setupUser(app);
    const apiRoutes = built.routes.filter((r) => r.url.startsWith("/api/") && r.method !== "HEAD");
    expect(apiRoutes.length).toBeGreaterThan(25);
    for (const r of apiRoutes) {
      if (r.url === "/api/health" || r.url === "/api/auth/status" || ["/api/auth/login", "/api/auth/setup"].includes(r.url)) continue;
      const url = r.url.replace(/:id/g, "1");
      const res = await app.inject({ method: r.method as "GET", url, headers: H, payload: r.method === "GET" ? undefined : {} });
      expect(res.statusCode, `${r.method} ${url} → ${res.statusCode}`).toBe(401);
    }
    for (const p of ["/api/auth/sessions", "/api/auth/logout", "/api/auth/password", "/api/auth/sessions/1"]) {
      for (const method of ["GET", "POST", "DELETE"] as const) {
        const res = await app.inject({ method, url: p, headers: H, payload: method === "GET" ? undefined : {} });
        expect([401, 404], `${method} ${p} → ${res.statusCode}`).toContain(res.statusCode);
      }
    }
  });
});
