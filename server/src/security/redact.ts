const SECRET_KEYS = /pass(word)?|token|secret|api[_-]?key|authorization|cookie|setup[_-]?code/i;
const SECRET_VALUES = [/sk-ant-[A-Za-z0-9_\-]{8,}/g, /sk-[A-Za-z0-9]{20,}/g];

/** Oculta valores sensibles antes de registrarlos o mostrarlos. */
export function redactSecrets<T>(value: T): T {
  return walk(value, 0) as T;
}

function walk(v: unknown, depth: number): unknown {
  if (depth > 6) return "[…]";
  if (typeof v === "string") {
    let s = v;
    for (const re of SECRET_VALUES) s = s.replace(re, "[REDACTADO]");
    return s;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SECRET_KEYS.test(k) ? "[REDACTADO]" : walk(val, depth + 1);
    }
    return out;
  }
  return v;
}
