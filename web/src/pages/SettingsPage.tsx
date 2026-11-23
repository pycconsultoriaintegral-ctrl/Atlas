import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, formatDate } from "../lib/api";
import { usePrefs } from "../lib/prefs";
import { speak, speechRecognitionSupported, speechSynthesisSupported, stopSpeaking, unlockSpeech, voicesFor } from "../lib/voice";
import { useUi } from "../components/ui";

interface ModelInfo {
  id: string;
  label: string;
  description: string;
  available: boolean;
  pricing?: { input: number; output: number };
}
interface ToolInfo {
  name: string;
  label: string;
  module: string;
  description: string;
  sensitive: boolean;
  permission: "auto" | "confirm" | "disabled";
}
interface SettingsResp {
  settings: { model: string; effort: string; userName: string; timezone: string; toolPermissions: Record<string, string> };
  models: ModelInfo[];
  ai: { configured: boolean; effectiveModel: string; demo: boolean };
  efforts: string[];
  tools: ToolInfo[];
}

const EFFORT_ES: Record<string, string> = {
  low: "Bajo — más rápido y económico",
  medium: "Medio — equilibrado (recomendado)",
  high: "Alto — más reflexivo",
  xhigh: "Muy alto — tareas complejas",
  max: "Máximo — el más lento y costoso",
};

const LANGS = [
  ["es-MX", "Español (México)"],
  ["es-US", "Español (Estados Unidos)"],
  ["es-CO", "Español (Colombia)"],
  ["es-CL", "Español (Chile)"],
  ["es-AR", "Español (Argentina)"],
  ["es-ES", "Español (España)"],
] as const;

export function SettingsPage({ onLogout }: { onLogout(): void }) {
  return (
    <div className="page">
      <h2>Configuración</h2>
      <AiSettings />
      <VoiceSettings />
      <ToolSettings />
      <SecuritySettings onLogout={onLogout} />
      <InstallHelp />
      <AuditLog />
    </div>
  );
}

function useSettings() {
  const { toast } = useUi();
  const [data, setData] = useState<SettingsResp | null>(null);
  const load = useCallback(() => {
    api<SettingsResp>("/api/settings").then(setData).catch((e) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api("/api/settings", { method: "PATCH", body });
      toast("Guardado.");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
      load();
    }
  };
  return { data, patch };
}

function AiSettings() {
  const { data, patch } = useSettings();
  const [userName, setUserName] = useState("");
  const [timezone, setTimezone] = useState("");
  useEffect(() => {
    if (data) {
      setUserName(data.settings.userName);
      setTimezone(data.settings.timezone);
    }
  }, [data]);
  if (!data) return <div className="card muted">Cargando…</div>;
  return (
    <section className="card stack">
      <h3>Inteligencia artificial</h3>
      {data.ai.demo ? (
        <div className="alert warn">
          Modo demostración: falta la API key de Anthropic en el servidor (archivo .env). Ver README → “Configurar la IA”.
        </div>
      ) : (
        <div className="alert ok">Conectado a Anthropic Claude.</div>
      )}
      <div className="grid2">
        <label className="field">
          Modelo
          <select className="select" value={data.ai.effectiveModel} onChange={(e) => patch({ model: e.target.value })}>
            {data.models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.label}
                {m.pricing ? ` · $${m.pricing.input}/$${m.pricing.output} por 1M tokens` : ""}
                {!m.available ? " (requiere API key)" : ""}
              </option>
            ))}
          </select>
          <span className="faint small">{data.models.find((m) => m.id === data.ai.effectiveModel)?.description}</span>
        </label>
        <label className="field">
          Nivel de razonamiento
          <select className="select" value={data.settings.effort} onChange={(e) => patch({ effort: e.target.value })}>
            {data.efforts.map((e) => (
              <option key={e} value={e}>
                {EFFORT_ES[e] ?? e}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        className="grid2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          patch({ userName, timezone });
        }}
      >
        <label className="field">
          ¿Cómo quieres que ATLAS te llame?
          <input className="input" value={userName} maxLength={60} onChange={(e) => setUserName(e.target.value)} placeholder="Ej.: Pablo" />
        </label>
        <label className="field">
          Zona horaria (vacío = la del dispositivo)
          <input
            className="input"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
        </label>
        <div>
          <button className="btn" type="submit">
            Guardar preferencias
          </button>
        </div>
      </form>
    </section>
  );
}

function VoiceSettings() {
  const [prefs, setPrefs] = usePrefs();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSynthesisSupported()) return;
    const update = () => setVoices(voicesFor(prefs.voiceLang));
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [prefs.voiceLang]);

  return (
    <section className="card stack">
      <h3>Voz (en este dispositivo)</h3>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className={`badge ${speechRecognitionSupported() ? "ok" : "warn"}`}>Dictado: {speechRecognitionSupported() ? "disponible" : "no disponible"}</span>
        <span className={`badge ${speechSynthesisSupported() ? "ok" : "warn"}`}>Lectura en voz alta: {speechSynthesisSupported() ? "disponible" : "no disponible"}</span>
      </div>
      <div className="grid2">
        <label className="field">
          Idioma de reconocimiento
          <select className="select" value={prefs.voiceLang} onChange={(e) => setPrefs({ voiceLang: e.target.value, voiceURI: "" })}>
            {LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Voz de ATLAS
          <select className="select" value={prefs.voiceURI} onChange={(e) => setPrefs({ voiceURI: e.target.value })}>
            <option value="">Automática</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Velocidad: {prefs.voiceRate.toFixed(2)}×
        <input type="range" min={0.7} max={1.5} step={0.05} value={prefs.voiceRate} onChange={(e) => setPrefs({ voiceRate: Number(e.target.value) })} />
      </label>
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            unlockSpeech();
            stopSpeaking();
            speak("Hola, soy ATLAS. Así sonará mi voz.");
          }}
        >
          Probar voz
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={prefs.silent} onChange={(e) => setPrefs({ silent: e.target.checked })} />
        <span>
          Modo silencioso <small>ATLAS nunca hablará en este dispositivo.</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.speakReplies} onChange={(e) => setPrefs({ speakReplies: e.target.checked })} />
        <span>
          Responder en voz alta cuando le hablo <small>Si dictas un mensaje, ATLAS lee su respuesta.</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.speakAlways} onChange={(e) => setPrefs({ speakAlways: e.target.checked })} />
        <span>
          Leer siempre todas las respuestas <small>También las de mensajes escritos.</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.autoSendVoice} onChange={(e) => setPrefs({ autoSendVoice: e.target.checked })} />
        <span>
          Enviar automáticamente al terminar de hablar <small>Si lo desactivas, podrás revisar el texto antes de enviarlo.</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.continuousConversation} onChange={(e) => setPrefs({ continuousConversation: e.target.checked })} />
        <span>
          Conversación continua <small>Tras responder en voz alta, ATLAS vuelve a escuchar. El micrófono nunca se enciende solo al abrir la app.</small>
        </span>
      </label>
    </section>
  );
}

function ToolSettings() {
  const { data, patch } = useSettings();
  if (!data) return null;
  const modules = [...new Set(data.tools.map((t) => t.module))];
  return (
    <section className="card stack">
      <h3>Permisos de herramientas</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Decide qué puede hacer ATLAS por sí solo. Las acciones sensibles (🔒) siempre piden tu confirmación, sin excepción.
      </p>
      {modules.map((mod) => (
        <div key={mod} className="stack" style={{ gap: 6 }}>
          <strong className="small" style={{ color: "var(--cyan)" }}>
            {mod}
          </strong>
          {data.tools
            .filter((t) => t.module === mod)
            .map((t) => (
              <div key={t.name} className="row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    {t.sensitive && "🔒 "}
                    {t.label}
                  </div>
                  <div className="faint small">{t.description.split(". ")[0]}.</div>
                </div>
                <select
                  className="select"
                  style={{ width: 150, flex: "none" }}
                  value={t.permission}
                  onChange={(e) => patch({ toolPermissions: { ...data.settings.toolPermissions, [t.name]: e.target.value } })}
                  aria-label={`Permiso para ${t.label}`}
                >
                  {!t.sensitive && <option value="auto">Automático</option>}
                  <option value="confirm">Pedir confirmación</option>
                  <option value="disabled">Desactivada</option>
                </select>
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}

interface SessionInfo {
  id: number;
  label: string | null;
  ip: string | null;
  last_seen_at: string;
  created_at: string;
  current: boolean;
}

function SecuritySettings({ onLogout }: { onLogout(): void }) {
  const { toast, confirm } = useUi();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const load = useCallback(() => {
    api<{ sessions: SessionInfo[] }>("/api/auth/sessions").then((r) => setSessions(r.sessions)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function revoke(s: SessionInfo) {
    await api(`/api/auth/sessions/${s.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
    load();
  }
  async function revokeOthers() {
    if (!(await confirm({ title: "¿Cerrar todas las demás sesiones?", body: "Tendrás que volver a iniciar sesión en tus otros dispositivos.", confirmText: "Cerrar sesiones", danger: true })))
      return;
    const r = await api<{ revoked: number }>("/api/auth/sessions/revoke-others", { method: "POST" }).catch((e) => toast(e.message, "error"));
    if (r) toast(`Se cerraron ${r.revoked} sesiones.`);
    load();
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: cur, newPassword: next } });
      setCur("");
      setNext("");
      toast("Contraseña actualizada. Se cerraron las demás sesiones.");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    onLogout();
  }

  return (
    <section className="card stack">
      <h3>Seguridad y sesiones</h3>
      <div className="list">
        {sessions.map((s) => (
          <div key={s.id} className="item" style={{ padding: "8px 12px" }}>
            <div className="body">
              <div>
                {s.label ?? "Dispositivo"} {s.current && <span className="badge ok">Esta sesión</span>}
              </div>
              <div className="faint small">
                Última actividad: {formatDate(s.last_seen_at)}
                {s.ip ? ` · IP ${s.ip}` : ""}
              </div>
            </div>
            {!s.current && (
              <button className="btn small ghost" onClick={() => revoke(s)}>
                Cerrar
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn" onClick={revokeOthers} disabled={sessions.length < 2}>
          Cerrar las demás sesiones
        </button>
        <span className="spacer" />
        <button className="btn danger" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
      <form className="stack" onSubmit={changePassword}>
        <strong className="small">Cambiar contraseña</strong>
        <div className="grid2">
          <input className="input" type="password" autoComplete="current-password" placeholder="Contraseña actual" value={cur} onChange={(e) => setCur(e.target.value)} required />
          <input className="input" type="password" autoComplete="new-password" placeholder="Nueva contraseña" value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div>
          <button className="btn" type="submit">
            Actualizar contraseña
          </button>
        </div>
      </form>
    </section>
  );
}

function InstallHelp() {
  return (
    <section className="card stack">
      <h3>Instalar ATLAS en el iPhone</h3>
      <ol className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Abre la dirección de ATLAS en <strong>Safari</strong> (debe empezar por https://).</li>
        <li>Toca el botón <strong>Compartir</strong> (cuadro con flecha hacia arriba).</li>
        <li>
          Elige <strong>“Agregar a pantalla de inicio”</strong> y confirma.
        </li>
        <li>Abre ATLAS desde el nuevo ícono: se verá como una app, a pantalla completa.</li>
      </ol>
      <span className="faint small">Guía completa en docs/IPHONE.md.</span>
    </section>
  );
}

interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  ip: string | null;
}

const ACTION_ES: Record<string, string> = {
  "auth.login": "Inicio de sesión",
  "auth.login_failed": "Intento de acceso fallido",
  "auth.logout": "Cierre de sesión",
  "auth.setup": "Cuenta creada",
  "auth.password_changed": "Contraseña cambiada",
  "auth.session_revoked": "Sesión cerrada",
  "auth.sessions_revoked": "Sesiones cerradas",
  "tool.executed": "Herramienta ejecutada",
  "tool.failed": "Herramienta con error",
  "tool.blocked": "Herramienta bloqueada",
  "action.requested": "Confirmación solicitada",
  "action.approved": "Acción aprobada",
  "action.rejected": "Acción rechazada",
  "emergency.stop": "BOTÓN DE EMERGENCIA",
  "device.created": "Dispositivo vinculado",
  "device.revoked": "Dispositivo revocado",
  "device.connected": "Dispositivo conectado",
  "device.disconnected": "Dispositivo desconectado",
  "device.auth_failed": "Conexión de dispositivo rechazada",
  "settings.updated": "Configuración cambiada",
  "memory.created": "Recuerdo creado",
  "memory.updated": "Recuerdo editado",
  "memory.deleted": "Recuerdo eliminado",
  "conversation.deleted": "Conversación eliminada",
  "project.deleted": "Proyecto eliminado",
};

function AuditLog() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => {
    if (open) api<{ entries: AuditEntry[] }>("/api/audit").then((r) => setEntries(r.entries)).catch(() => {});
  }, [open]);
  return (
    <section className="card stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Registro de operaciones</h3>
        <span className="spacer" />
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? "Ocultar" : "Ver"}
        </button>
      </div>
      {open && (
        <div>
          {entries.map((e) => (
            <div key={e.id} className="audit-row">
              <span className="faint">{formatDate(e.ts)}</span>
              <span>
                <strong>{ACTION_ES[e.action] ?? e.action}</strong> <code>{e.actor}</code>
                {typeof e.detail.summary === "string" && <div className="muted">{e.detail.summary}</div>}
              </span>
            </div>
          ))}
          {!entries.length && <div className="muted small">Sin registros.</div>}
        </div>
      )}
    </section>
  );
}
