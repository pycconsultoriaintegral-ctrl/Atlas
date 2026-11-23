import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, formatDate, type Device } from "../lib/api";
import { IconPlus, IconTrash } from "../components/Icons";
import { useUi } from "../components/ui";

const STATE: Record<Device["state"], { label: string; cls: string }> = {
  online: { label: "Conectado", cls: "ok" },
  busy: { label: "Ocupado", cls: "warn" },
  error: { label: "Error", cls: "danger" },
  offline: { label: "Desconectado", cls: "" },
};

export function DevicesPage() {
  const { toast, confirm } = useUi();
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState("");
  const [token, setToken] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(() => {
    api<{ devices: Device[] }>("/api/devices").then((r) => setDevices(r.devices)).catch((e) => toast(e.message, "error"));
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ device: Device; token: string }>("/api/devices", { method: "POST", body: { name, kind: "windows" } });
      setToken({ name: r.device.name, token: r.token });
      setName("");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function revoke(d: Device) {
    const ok = await confirm({
      title: `¿Revocar "${d.name}"?`,
      body: "El dispositivo se desconectará y su token dejará de funcionar para siempre.",
      confirmText: "Revocar",
      danger: true,
    });
    if (!ok) return;
    await api(`/api/devices/${d.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
    load();
  }

  const active = devices.filter((d) => !d.revoked);

  return (
    <div className="page">
      <h2>Dispositivos</h2>
      <div className="card">
        <h3>Agente de Windows</h3>
        <p className="muted small" style={{ margin: 0 }}>
          El agente de Windows (Fase 3) permitirá que ATLAS abra programas, gestione archivos y ejecute tareas autorizadas en tu computador, incluso
          cuando se lo pidas desde el iPhone. El cerebro central ya está preparado: aquí podrás vincularlo con un token propio, ver si está
          conectado y revocarlo cuando quieras.
        </p>
      </div>

      {token && (
        <div className="card stack" style={{ borderColor: "var(--warn)" }}>
          <h3>Token de “{token.name}”</h3>
          <p className="small" style={{ margin: 0 }}>
            Cópialo ahora: <strong>sólo se muestra esta vez</strong>. Lo pegarás en el agente de Windows al instalarlo. Trátalo como una
            contraseña.
          </p>
          <div className="token-box">{token.token}</div>
          <div className="row">
            <button
              className="btn"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(token.token)
                  .then(() => toast("Token copiado."))
                  .catch(() => toast("No se pudo copiar; selecciónalo manualmente.", "error"))
              }
            >
              Copiar
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={() => setToken(null)}>
              Ya lo guardé
            </button>
          </div>
        </div>
      )}

      <form className="row wrap" onSubmit={create}>
        <input className="input" style={{ flex: "1 1 220px" }} placeholder="Nombre (ej.: PC Oficina)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={!name.trim()}>
          <IconPlus width={18} /> Vincular dispositivo
        </button>
      </form>

      <div className="list">
        {active.map((d) => (
          <div key={d.id} className="item">
            <div className="body">
              <div className="row wrap" style={{ gap: 8 }}>
                <strong>{d.name}</strong>
                <span className={`badge ${STATE[d.state].cls}`}>
                  <span className="dot" /> {STATE[d.state].label}
                </span>
              </div>
              <div className="faint small">
                {d.currentTask ? `Tarea: ${d.currentTask} · ` : ""}
                {d.hostname ? `${d.hostname} · ` : ""}
                {d.last_seen_at ? `Visto: ${formatDate(d.last_seen_at)}` : "Nunca conectado"}
              </div>
              {d.lastError && <div className="error-text small">{d.lastError}</div>}
            </div>
            <div className="actions">
              <button className="icon-btn" aria-label={`Revocar ${d.name}`} onClick={() => revoke(d)}>
                <IconTrash />
              </button>
            </div>
          </div>
        ))}
        {!active.length && <div className="empty">No hay dispositivos vinculados todavía.</div>}
      </div>
    </div>
  );
}
