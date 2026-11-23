import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Orbe de estado ──────────────────────────────────────────
export type OrbState = "idle" | "thinking" | "writing" | "tool" | "listening" | "speaking" | "offline";

export function Orb({ state = "idle", size = 40 }: { state?: OrbState; size?: number }) {
  return (
    <div className={`orb ${state}`} style={{ ["--size" as string]: `${size}px` }} role="img" aria-label={`ATLAS: ${STATE_LABEL[state]}`}>
      <div className="ring" />
      <div className="ring r2" />
      <div className="core" />
    </div>
  );
}

export const STATE_LABEL: Record<OrbState, string> = {
  idle: "En línea",
  thinking: "Pensando…",
  writing: "Respondiendo…",
  tool: "Ejecutando una tarea…",
  listening: "Escuchando…",
  speaking: "Hablando…",
  offline: "Sin conexión",
};

// ── Markdown seguro (sin HTML crudo) ────────────────────────
export function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

// ── Avisos y diálogos de confirmación ───────────────────────
interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}
interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  danger?: boolean;
}
interface UiCtx {
  toast(text: string, kind?: "info" | "error"): void;
  confirm(opts: ConfirmOpts): Promise<boolean>;
}
const Ctx = createContext<UiCtx>({ toast: () => {}, confirm: async () => false });
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve(v: boolean): void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: "info" | "error" = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })), []);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            {t.text}
          </div>
        ))}
      </div>
      {dialog && (
        <div className="overlay" onClick={() => close(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="dlg-title">{dialog.title}</h3>
            {dialog.body && <div className="muted">{dialog.body}</div>}
            <div className="row">
              <button className="btn ghost" onClick={() => close(false)}>
                Cancelar
              </button>
              <span className="spacer" />
              <button className={`btn ${dialog.danger ? "danger" : "primary"}`} autoFocus onClick={() => close(true)}>
                {dialog.confirmText ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

// ── Enrutador mínimo por hash (#/chat, #/memoria…) ──────────
export function useHashRoute(): [string[], (path: string) => void, number] {
  const parse = () => (window.location.hash.replace(/^#\/?/, "") || "chat").split("/").filter(Boolean);
  const [state, setState] = useState(() => ({ route: parse(), n: 0 }));
  useEffect(() => {
    const on = () => setState((s) => ({ route: parse(), n: s.n + 1 }));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((path: string) => {
    if (window.location.hash === `#/${path}`) setState((s) => ({ route: parse(), n: s.n + 1 }));
    else window.location.hash = `#/${path}`;
  }, []);
  return [state.route, go, state.n];
}
