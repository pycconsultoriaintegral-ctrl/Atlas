import { useState, type FormEvent } from "react";
import { api, type User } from "../lib/api";
import { Orb } from "../components/ui";

export function AuthPage({ setup, onDone }: { setup: boolean; onDone(user: User): void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (setup && password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const res = setup
        ? await api<{ user: User }>("/api/auth/setup", { method: "POST", body: { setupCode: code, username, password } })
        : await api<{ user: User }>("/api/auth/login", { method: "POST", body: { username, password } });
      onDone(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <div className="logo">
          <Orb size={74} state={busy ? "thinking" : "idle"} />
          <h1>ATLAS</h1>
          <span className="muted small">{setup ? "Configuración inicial — crea tu cuenta" : "Tu asistente personal"}</span>
        </div>

        {setup && (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              Por seguridad necesitas el <strong>código de configuración</strong> que aparece en la ventana del servidor (o en
              <code> data/CODIGO-DE-CONFIGURACION.txt</code>).
            </p>
            <label className="field">
              Código de configuración
              <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
          </>
        )}
        <label className="field">
          Usuario
          <input
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Contraseña
          <input
            className="input"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {setup && (
          <>
            <label className="field">
              Repite la contraseña
              <input className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
            </label>
            <span className="faint small">Mínimo 10 caracteres, con letras y números. Guárdala en un gestor de contraseñas.</span>
          </>
        )}
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? "Un momento…" : setup ? "Crear cuenta y entrar" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
