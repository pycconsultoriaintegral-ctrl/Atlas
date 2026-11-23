import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  api,
  clientDevice,
  clientTimezone,
  formatDate,
  streamPost,
  type ChatEvent,
  type Conversation,
  type PendingActionCard,
  type StoredMessage,
  type ToolActivity,
} from "../lib/api";
import { getPrefs } from "../lib/prefs";
import { listen, speak, speechRecognitionSupported, stopSpeaking, unlockSpeech, type ListenHandle } from "../lib/voice";
import { IconAlert, IconCheck, IconCircle, IconClose, IconMic, IconPlus, IconSend, IconStop, IconTrash } from "../components/Icons";
import { Md, Orb, useUi, type OrbState } from "../components/ui";

interface UiMsg {
  key: string;
  role: "user" | "assistant" | "notice" | "decision";
  text: string;
  tools: ToolActivity[];
  interrupted?: boolean;
  live?: boolean;
}

/** El aviso de modo demostración se muestra una sola vez por sesión. */
let demoNoticeShown = false;

const SUGGESTIONS = [
  "¿Qué puedes hacer por mí?",
  "Recuerda que prefiero respuestas breves y directas",
  "Crea una tarea: revisar el presupuesto mensual",
  "Ayúdame a organizar mi semana",
];

/** Agrupa los pasos consecutivos de ATLAS en una sola burbuja. */
function toUi(messages: StoredMessage[]): UiMsg[] {
  const out: UiMsg[] = [];
  for (const m of messages) {
    if (m.kind === "notice") {
      out.push({ key: `m${m.id}`, role: "notice", text: m.display_text, tools: [] });
    } else if (m.kind === "action_decision") {
      out.push({ key: `m${m.id}`, role: "decision", text: m.display_text, tools: [] });
    } else if (m.role === "user") {
      out.push({ key: `m${m.id}`, role: "user", text: m.display_text, tools: [] });
    } else if (m.role === "assistant") {
      const prev = out[out.length - 1];
      const tools = m.meta.tools ?? [];
      if (prev?.role === "assistant") {
        prev.text = [prev.text, m.display_text].filter(Boolean).join("\n\n");
        prev.tools = [...prev.tools, ...tools];
        prev.interrupted = prev.interrupted || m.meta.interrupted;
      } else {
        out.push({ key: `m${m.id}`, role: "assistant", text: m.display_text, tools, interrupted: m.meta.interrupted });
      }
    }
  }
  return out;
}

export function ChatPage({
  routeId,
  navKey,
  go,
  setOrb,
  demo,
}: {
  routeId: string | undefined;
  /** Cambia en cada navegación (para reaccionar aunque el id sea el mismo). */
  navKey: number;
  go(path: string): void;
  setOrb(s: OrbState): void;
  demo: boolean;
}) {
  const { toast, confirm } = useUi();
  const [convId, setConvId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [pending, setPending] = useState<PendingActionCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<OrbState>("idle");
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [title, setTitle] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const listenRef = useRef<ListenHandle | null>(null);
  const liveConv = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(text: string, viaVoice: boolean) => void>(() => {});

  const loadList = useCallback(async () => {
    try {
      const r = await api<{ conversations: Conversation[] }>(`/api/conversations${search ? `?q=${encodeURIComponent(search)}` : ""}`);
      setConversations(r.conversations);
    } catch {
      /* se reintenta en la próxima acción */
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(loadList, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, search]);

  // Cargar conversación según la ruta (#/chat/123).
  useEffect(() => {
    const id = routeId && routeId !== "new" ? Number(routeId) : null;
    if (id && id === liveConv.current && messages.length) return; // ya se está mostrando (creada en vivo)
    setConvId(id);
    liveConv.current = id;
    setPending([]);
    setHistoryOpen(false);
    if (!id) {
      setMessages([]);
      setTitle("");
      return;
    }
    let cancelled = false;
    api<{ conversation: Conversation; messages: StoredMessage[]; pendingActions: PendingActionCard[] }>(`/api/conversations/${id}`)
      .then((r) => {
        if (cancelled) return;
        setMessages(toUi(r.messages));
        setPending(r.pendingActions);
        setTitle(r.conversation.title);
        stick.current = true;
      })
      .catch((e) => {
        toast((e as Error).message, "error");
        go("chat");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, navKey, go, toast]);

  useEffect(() => {
    const on = () => setHistoryOpen((v) => !v);
    window.addEventListener("atlas:toggle-history", on);
    return () => window.removeEventListener("atlas:toggle-history", on);
  }, []);

  // Desplazamiento automático mientras ATLAS escribe.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  useEffect(() => {
    setOrb(listening ? "listening" : busy ? phase : "idle");
  }, [busy, phase, listening, setOrb]);

  const patchLive = (fn: (m: UiMsg) => UiMsg) =>
    setMessages((ms) => {
      const i = ms.findIndex((m) => m.live);
      if (i < 0) return ms;
      const copy = ms.slice();
      copy[i] = fn(copy[i]!);
      return copy;
    });

  const runStream = useCallback(
    async (url: string, body: unknown, viaVoice: boolean) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setPhase("thinking");
      stick.current = true;
      let finalText = "";
      let failed = false;
      const onEvent = (e: ChatEvent) => {
        switch (e.type) {
          case "conversation":
            if (liveConv.current !== e.id) {
              liveConv.current = e.id;
              setConvId(e.id);
              setTitle(e.title);
              window.history.replaceState(null, "", `#/chat/${e.id}`);
            }
            break;
          case "status":
            if (e.state !== "idle") setPhase(e.state);
            break;
          case "text":
            finalText += e.delta;
            patchLive((m) => ({ ...m, text: m.text + e.delta }));
            break;
          case "step":
            patchLive((m) => (m.text && !m.text.endsWith("\n\n") ? { ...m, text: `${m.text}\n\n` } : m));
            if (finalText && !finalText.endsWith("\n\n")) finalText += "\n\n";
            break;
          case "tool":
            patchLive((m) => {
              const tools = m.tools.slice();
              const i = tools.findIndex((t) => t.name === e.name && t.summary === e.summary && (t.status === "running" || t.status === e.status));
              const item = { name: e.name, label: e.label, summary: e.summary, status: e.status, actionId: e.actionId };
              if (i >= 0) tools[i] = item;
              else tools.push(item);
              return { ...m, tools };
            });
            break;
          case "confirmation":
            setPending((p) => [...p.filter((x) => x.id !== e.actionId), { id: e.actionId, tool: e.tool, label: e.label, summary: e.summary }]);
            break;
          case "notice":
            if (!/demostración/i.test(e.message) || !demoNoticeShown) {
              demoNoticeShown = true;
              toast(e.message);
            }
            break;
          case "error":
            failed = true;
            setMessages((ms) => [...ms.filter((m) => !(m.live && !m.text && !m.tools.length)), { key: `e${Date.now()}`, role: "notice", text: `⚠️ ${e.message}`, tools: [] }]);
            break;
          case "done":
            if (e.interrupted) patchLive((m) => ({ ...m, interrupted: true }));
            break;
        }
      };
      try {
        await streamPost(url, body, onEvent, controller.signal);
      } catch (err) {
        failed = true;
        toast((err as Error).message, "error");
        setMessages((ms) => ms.filter((m) => !(m.live && !m.text && !m.tools.length)));
      } finally {
        setMessages((ms) => ms.map((m) => (m.live ? { ...m, live: false } : m)));
        abortRef.current = null;
        setBusy(false);
        setPhase("idle");
        loadList();
      }
      const prefs = getPrefs();
      if (!failed && !controller.signal.aborted && finalText.trim() && !prefs.silent && ((viaVoice && prefs.speakReplies) || prefs.speakAlways)) {
        setOrb("speaking");
        speak(finalText, () => {
          setOrb("idle");
          if (viaVoice && getPrefs().continuousConversation) startListening();
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadList, toast, setOrb],
  );

  const send = useCallback(
    (raw: string, viaVoice = false) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput("");
      setMessages((ms) => [
        ...ms,
        { key: `u${Date.now()}`, role: "user", text, tools: [] },
        { key: `a${Date.now()}`, role: "assistant", text: "", tools: [], live: true },
      ]);
      runStream(
        "/api/chat",
        { conversationId: liveConv.current ?? undefined, message: text, timezone: clientTimezone(), device: clientDevice() },
        viaVoice,
      );
    },
    [busy, runStream],
  );
  sendRef.current = send;

  function stop() {
    abortRef.current?.abort();
    if (liveConv.current) api(`/api/conversations/${liveConv.current}/stop`, { method: "POST" }).catch(() => {});
    stopSpeaking();
    listenRef.current?.abort();
  }

  function startListening() {
    if (!speechRecognitionSupported()) {
      toast("El dictado no está disponible en este navegador. En iPhone puedes usar el micrófono del teclado.", "error");
      return;
    }
    stopSpeaking();
    setListening(true);
    listenRef.current = listen({
      onInterim: (t) => setInput(t),
      onFinal: (t) => {
        if (getPrefs().autoSendVoice) sendRef.current(t, true);
        else setInput(t);
      },
      onError: (msg) => toast(msg, "error"),
      onEnd: () => {
        setListening(false);
        listenRef.current = null;
      },
    });
    if (!listenRef.current) setListening(false);
  }

  function toggleMic() {
    unlockSpeech();
    if (listening) {
      listenRef.current?.stop();
      return;
    }
    startListening();
  }

  async function decide(action: PendingActionCard, decision: "approve" | "reject") {
    if (busy) return;
    if (decision === "approve") {
      const ok = await confirm({
        title: "¿Aprobar esta acción?",
        body: action.summary,
        confirmText: "Sí, aprobar",
        danger: true,
      });
      if (!ok) return;
    }
    setPending((p) => p.filter((x) => x.id !== action.id));
    setMessages((ms) => [
      ...ms,
      {
        key: `d${Date.now()}`,
        role: "decision",
        text: `${decision === "approve" ? "✅ Aprobé" : "❌ Rechacé"} la acción #${action.id}: ${action.summary}`,
        tools: [],
      },
      { key: `a${Date.now()}`, role: "assistant", text: "", tools: [], live: true },
    ]);
    runStream(`/api/actions/${action.id}/${decision}`, { timezone: clientTimezone(), device: clientDevice() }, false);
  }

  async function removeConversation(c: Conversation) {
    const ok = await confirm({ title: "¿Eliminar conversación?", body: `"${c.title}" se borrará definitivamente.`, confirmText: "Eliminar", danger: true });
    if (!ok) return;
    try {
      await api(`/api/conversations/${c.id}`, { method: "DELETE" });
      if (c.id === convId) go("chat/new");
      loadList();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  // Ajuste automático de altura del cuadro de texto.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const empty = messages.length === 0;

  return (
    <div className="chat-layout">
      <aside className={`conv-list ${historyOpen ? "open" : ""}`} aria-label="Historial de conversaciones">
        <div className="head">
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} onClick={() => go("chat/new")}>
              <IconPlus width={18} /> Nueva conversación
            </button>
            {historyOpen && (
              <button className="icon-btn" aria-label="Cerrar historial" onClick={() => setHistoryOpen(false)}>
                <IconClose />
              </button>
            )}
          </div>
          <input className="input" placeholder="Buscar en el historial…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul>
          {conversations.map((c) => (
            <li key={c.id} className="row" style={{ gap: 2 }}>
              <button className={c.id === convId ? "active" : ""} onClick={() => go(`chat/${c.id}`)}>
                <span className="t">{c.title}</span>
                <span className="p">
                  {formatDate(c.updated_at)}
                  {c.project_name ? ` · ${c.project_name}` : ""}
                </span>
              </button>
              <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Eliminar ${c.title}`} onClick={() => removeConversation(c)}>
                <IconTrash width={16} />
              </button>
            </li>
          ))}
          {!conversations.length && <li className="faint small" style={{ padding: 10 }}>{search ? "Sin resultados." : "Aún no hay conversaciones."}</li>}
        </ul>
      </aside>

      <section className="chat">
        <div
          className="messages"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="messages-inner">
            {empty ? (
              <div className="welcome">
                <Orb size={96} state={busy ? phase : "idle"} />
                <h1>ATLAS</h1>
                <p className="muted" style={{ margin: 0 }}>
                  {demo ? "Modo demostración — configura tu API key para activar la IA." : "¿En qué te ayudo hoy?"}
                </p>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn small" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              title && <div className="faint small" style={{ textAlign: "center" }}>{title}</div>
            )}

            {messages.map((m) => (
              <div key={m.key} className={`msg ${m.role}${m.key.startsWith("m") ? "" : " fresh"}`}>
                {m.role === "assistant" && <Orb size={26} state={m.live ? phase : "idle"} />}
                <div className="bubble">
                  {m.role === "assistant" ? (
                    <>
                      {m.tools.length > 0 && (
                        <div className="tools">
                          {m.tools.map((t, i) => (
                            <div key={i} className={`tool-chip ${t.status}`}>
                              <span className="ic">
                                {t.status === "ok" ? (
                                  <IconCheck width={15} />
                                ) : t.status === "error" || t.status === "disabled" ? (
                                  <IconAlert width={15} />
                                ) : (
                                  <IconCircle width={15} />
                                )}
                              </span>
                              <span>
                                {t.summary}
                                {t.status === "pending" && " — esperando tu confirmación"}
                                {t.status === "disabled" && " — herramienta desactivada"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {m.text ? <Md text={m.text} /> : m.live && <div className="typing" aria-label="ATLAS está pensando"><span /><span /><span /></div>}
                      {m.interrupted && <div className="meta">Respuesta detenida.</div>}
                    </>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            ))}

            {pending.map((a) => (
              <div key={a.id} className="confirm-card" role="group" aria-label="Acción que requiere confirmación">
                <div className="row">
                  <IconAlert width={20} color="var(--warn)" />
                  <strong>Confirmación requerida</strong>
                </div>
                <div>{a.summary}</div>
                <div className="faint small">ATLAS no hará esto sin tu aprobación explícita.</div>
                <div className="row">
                  <button className="btn" disabled={busy} onClick={() => decide(a, "reject")}>
                    Rechazar
                  </button>
                  <button className="btn danger" disabled={busy} onClick={() => decide(a, "approve")}>
                    Aprobar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="composer">
          <div className="composer-inner">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder={listening ? "Escuchando…" : "Escribe o habla con ATLAS…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              enterKeyHint="send"
              aria-label="Mensaje para ATLAS"
            />
            {busy ? (
              <button className="round stop" onClick={stop} aria-label="Detener respuesta">
                <IconStop />
              </button>
            ) : input.trim() && !listening ? (
              <button className="round send" onClick={() => send(input)} aria-label="Enviar">
                <IconSend />
              </button>
            ) : (
              <button className={`round mic ${listening ? "on" : ""}`} onClick={toggleMic} aria-label={listening ? "Dejar de escuchar" : "Hablar con ATLAS"} aria-pressed={listening}>
                <IconMic />
              </button>
            )}
          </div>
          <div className="hint">{listening ? "Micrófono activo — toca de nuevo para terminar" : busy ? "Toca ■ para detener" : ""}</div>
        </div>
      </section>
    </div>
  );
}
