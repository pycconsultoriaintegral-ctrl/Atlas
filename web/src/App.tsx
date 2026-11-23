import { useCallback, useEffect, useState } from "react";
import { api, setUnauthorizedHandler, type User } from "./lib/api";
import { usePrefs } from "./lib/prefs";
import { onSpeakingChange, stopSpeaking } from "./lib/voice";
import { IconChat, IconDevices, IconHistory, IconMemory, IconMute, IconPlus, IconSettings, IconShield, IconTasks, IconVolume } from "./components/Icons";
import { Orb, STATE_LABEL, UiProvider, useHashRoute, useUi, type OrbState } from "./components/ui";
import { AuthPage } from "./pages/AuthPage";
import { ChatPage } from "./pages/ChatPage";
import { DevicesPage } from "./pages/DevicesPage";
import { MemoryPage } from "./pages/MemoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";

interface SystemStatus {
  ai: { demo: boolean; model: string; configured: boolean };
  devices: { total: number; online: number };
  pendingActions: number;
}

export default function App() {
  return (
    <UiProvider>
      <Root />
    </UiProvider>
  );
}

function Root() {
  const [state, setState] = useState<{ loading: boolean; setupRequired: boolean; user: User | null; error?: string }>({
    loading: true,
    setupRequired: false,
    user: null,
  });

  const check = useCallback(async () => {
    try {
      const r = await api<{ setupRequired: boolean; user: User | null }>("/api/auth/status");
      setState({ loading: false, ...r });
    } catch (e) {
      setState({ loading: false, setupRequired: false, user: null, error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    check();
    setUnauthorizedHandler(() => setState((s) => ({ ...s, user: null })));
  }, [check]);

  if (state.loading) {
    return (
      <div className="auth">
        <Orb size={80} state="thinking" />
      </div>
    );
  }
  if (state.error && !state.user) {
    return (
      <div className="auth">
        <div className="card">
          <div className="logo">
            <Orb size={64} state="offline" />
            <h1>ATLAS</h1>
          </div>
          <p className="error-text">{state.error}</p>
          <button className="btn primary" onClick={check}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }
  if (!state.user) {
    return <AuthPage setup={state.setupRequired} onDone={(user) => setState({ loading: false, setupRequired: false, user })} />;
  }
  return <Shell onLogout={() => setState({ loading: false, setupRequired: false, user: null })} />;
}

const NAV = [
  { id: "chat", label: "Chat", Icon: IconChat },
  { id: "memoria", label: "Memoria", Icon: IconMemory },
  { id: "tareas", label: "Tareas", Icon: IconTasks },
  { id: "dispositivos", label: "Equipos", Icon: IconDevices },
  { id: "ajustes", label: "Ajustes", Icon: IconSettings },
];

function Shell({ onLogout }: { onLogout(): void }) {
  const { toast, confirm } = useUi();
  const [route, go, navKey] = useHashRoute();
  const [orb, setOrb] = useState<OrbState>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [prefs, setPrefs] = usePrefs();
  const page = route[0] ?? "chat";

  const loadStatus = useCallback(() => {
    api<SystemStatus>("/api/system/status")
      .then((s) => {
        setStatus(s);
        setOnline(true);
      })
      .catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 30_000);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, [loadStatus]);

  useEffect(() => onSpeakingChange(setSpeaking), []);

  async function emergency() {
    const ok = await confirm({
      title: "Botón de emergencia",
      body: "Se detendrán de inmediato todas las respuestas en curso, se rechazarán las acciones pendientes y se ordenará a tus dispositivos detener cualquier tarea.",
      confirmText: "DETENER TODO",
      danger: true,
    });
    if (!ok) return;
    stopSpeaking();
    try {
      const r = await api<{ stoppedResponses: number; rejectedActions: number; devicesNotified: number }>("/api/emergency-stop", { method: "POST" });
      toast(`Detenido. Respuestas: ${r.stoppedResponses} · acciones rechazadas: ${r.rejectedActions} · dispositivos avisados: ${r.devicesNotified}.`);
      loadStatus();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const effectiveOrb: OrbState = !online ? "offline" : speaking ? "speaking" : orb;
  const subtitle = !online
    ? "Sin conexión con el cerebro central"
    : effectiveOrb !== "idle"
      ? STATE_LABEL[effectiveOrb]
      : status?.ai.demo
        ? "En línea · modo demo"
        : `En línea${status ? ` · ${status.ai.model.replace("claude-", "Claude ").replace(/-/g, " ")}` : ""}`;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Navegación principal">
        <div className="brand">ATLAS</div>
        {NAV.map(({ id, label, Icon }) => (
          <a key={id} href={`#/${id}`} className={page === id ? "active" : ""} aria-current={page === id ? "page" : undefined}>
            <Icon />
            {label}
          </a>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <Orb size={38} state={effectiveOrb} />
          <div className="title">
            <strong>ATLAS</strong>
            <span aria-live="polite">{subtitle}</span>
          </div>
          <span className="spacer" />
          {page === "chat" && (
            <>
              <button className="icon-btn mobile-only" aria-label="Historial" onClick={() => window.dispatchEvent(new Event("atlas:toggle-history"))}>
                <IconHistory />
              </button>
              <button className="icon-btn" aria-label="Nueva conversación" onClick={() => go("chat/new")}>
                <IconPlus />
              </button>
            </>
          )}
          <button
            className={`icon-btn ${prefs.silent ? "" : "active"}`}
            aria-label={prefs.silent ? "Activar voz" : "Modo silencioso"}
            aria-pressed={prefs.silent}
            onClick={() => {
              if (!prefs.silent) stopSpeaking();
              setPrefs({ silent: !prefs.silent });
            }}
          >
            {prefs.silent ? <IconMute /> : <IconVolume />}
          </button>
          <button className="icon-btn emergency" aria-label="Botón de emergencia: detener todo" title="Detener todo" onClick={emergency}>
            <IconShield />
          </button>
        </header>

        <main className="content" style={page === "chat" ? { overflow: "hidden" } : undefined}>
          {page === "chat" && <ChatPage routeId={route[1]} navKey={navKey} go={go} setOrb={setOrb} demo={!!status?.ai.demo} />}
          {page === "memoria" && <MemoryPage />}
          {page === "tareas" && <TasksPage />}
          {page === "dispositivos" && <DevicesPage />}
          {page === "ajustes" && <SettingsPage onLogout={onLogout} />}
        </main>

        <nav className="tabbar" aria-label="Navegación">
          {NAV.map(({ id, label, Icon }) => (
            <a key={id} href={`#/${id}`} className={page === id ? "active" : ""} aria-current={page === id ? "page" : undefined}>
              <Icon />
              {label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
