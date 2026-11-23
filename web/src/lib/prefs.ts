import { useCallback, useEffect, useState } from "react";

/**
 * Preferencias propias de cada dispositivo (voz, modo silencioso…). Se guardan
 * localmente porque las voces disponibles son distintas en el iPhone y en Windows.
 */
export interface DevicePrefs {
  voiceLang: string;
  voiceURI: string;
  voiceRate: number;
  /** Leer en voz alta las respuestas a mensajes dictados por voz. */
  speakReplies: boolean;
  /** Leer en voz alta TODAS las respuestas (también las escritas). */
  speakAlways: boolean;
  /** Enviar automáticamente al terminar de dictar. */
  autoSendVoice: boolean;
  /** Tras leer una respuesta, volver a escuchar (conversación continua). */
  continuousConversation: boolean;
  /** Silencio total: nunca habla. */
  silent: boolean;
}

const DEFAULTS: DevicePrefs = {
  voiceLang: "es-MX",
  voiceURI: "",
  voiceRate: 1.05,
  speakReplies: true,
  speakAlways: false,
  autoSendVoice: true,
  continuousConversation: false,
  silent: false,
};

const KEY = "atlas.prefs.v1";
const listeners = new Set<(p: DevicePrefs) => void>();

function read(): DevicePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();

export function getPrefs() {
  return current;
}

export function setPrefs(patch: Partial<DevicePrefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* almacenamiento no disponible (modo privado): se mantiene en memoria */
  }
  listeners.forEach((l) => l(current));
}

export function usePrefs(): [DevicePrefs, (p: Partial<DevicePrefs>) => void] {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    return () => void listeners.delete(setP);
  }, []);
  return [p, useCallback(setPrefs, [])];
}
