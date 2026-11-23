import { getPrefs } from "./prefs";

/**
 * Voz: dictado (voz → texto) y lectura (texto → voz) usando las capacidades
 * nativas del navegador (Safari en iPhone, Edge/Chrome en Windows). Gratis, sin
 * enviar audio a servicios externos de ATLAS. El micrófono sólo se activa cuando
 * tocas el botón.
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

export function speechRecognitionSupported(): boolean {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface ListenHandle {
  stop(): void;
  abort(): void;
}

export function listen(handlers: {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onError(message: string): void;
  onEnd(): void;
}): ListenHandle | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onError("Este navegador no permite dictado por voz. Usa el micrófono del teclado del iPhone o Edge/Chrome en Windows.");
    return null;
  }
  const rec: Recognition = new Ctor();
  rec.lang = getPrefs().voiceLang || "es-MX";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    handlers.onInterim((finalText + interim).trim());
  };
  rec.onerror = (e: any) => {
    const map: Record<string, string> = {
      "not-allowed": "Permiso de micrófono denegado. Actívalo en Ajustes del navegador.",
      "service-not-allowed": "El dictado no está permitido en este modo. Prueba desde Safari o activa Siri y Dictado.",
      "no-speech": "No escuché nada. Inténtalo de nuevo.",
      "audio-capture": "No se encontró un micrófono.",
      network: "El dictado necesita conexión a internet.",
    };
    if (e.error !== "aborted") handlers.onError(map[e.error] ?? `Error de dictado (${e.error}).`);
  };
  rec.onend = () => {
    if (finalText.trim()) handlers.onFinal(finalText.trim());
    handlers.onEnd();
  };
  try {
    rec.start();
  } catch {
    handlers.onError("No se pudo iniciar el micrófono.");
    return null;
  }
  return { stop: () => rec.stop(), abort: () => rec.abort() };
}

// ── Texto a voz ────────────────────────────────────────────

let speakingCount = 0;
const speakListeners = new Set<(speaking: boolean) => void>();
function setSpeaking(delta: number) {
  speakingCount = Math.max(0, speakingCount + delta);
  speakListeners.forEach((l) => l(speakingCount > 0));
}
export function onSpeakingChange(fn: (speaking: boolean) => void) {
  speakListeners.add(fn);
  return () => void speakListeners.delete(fn);
}

export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  if (!speechSynthesisSupported()) return [];
  const prefix = lang.split("-")[0]!.toLowerCase();
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix));
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const { voiceURI, voiceLang } = getPrefs();
  const all = speechSynthesis.getVoices();
  return (
    all.find((v) => v.voiceURI === voiceURI) ??
    all.find((v) => v.lang.replace("_", "-") === voiceLang) ??
    all.find((v) => /^es-(419|MX|US|CO|AR|CL)/i.test(v.lang.replace("_", "-"))) ??
    all.find((v) => v.lang.toLowerCase().startsWith("es"))
  );
}

/** Quita Markdown y elementos que no tiene sentido leer en voz alta. */
export function toSpeakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (bloque de código omitido) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/[*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lee un texto en voz alta (dividido en frases: más fiable en iOS). */
export function speak(text: string, onDone?: () => void) {
  if (!speechSynthesisSupported() || getPrefs().silent) {
    onDone?.();
    return;
  }
  const clean = toSpeakable(text);
  if (!clean) {
    onDone?.();
    return;
  }
  const parts = clean.match(/[^.!?¿¡;:]+[.!?;:]*|[¿¡][^?!]*[?!]/g) ?? [clean];
  const chunks: string[] = [];
  for (const p of parts) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + p.length < 220) chunks[chunks.length - 1] = `${last} ${p.trim()}`;
    else chunks.push(p.trim());
  }
  const voice = pickVoice();
  const { voiceRate, voiceLang } = getPrefs();
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? voiceLang;
    u.rate = voiceRate;
    if (i === 0) u.onstart = () => setSpeaking(+1);
    if (i === chunks.length - 1) {
      u.onend = () => {
        setSpeaking(-1);
        onDone?.();
      };
      u.onerror = () => {
        setSpeaking(-1);
      };
    }
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (speechSynthesisSupported()) speechSynthesis.cancel();
  speakingCount = 0;
  speakListeners.forEach((l) => l(false));
}

/** iOS exige que la primera lectura ocurra tras un toque del usuario. */
export function unlockSpeech() {
  if (!speechSynthesisSupported() || (unlockSpeech as any).done) return;
  (unlockSpeech as any).done = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}
