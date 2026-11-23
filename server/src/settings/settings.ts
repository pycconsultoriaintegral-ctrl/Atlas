import { z } from "zod";
import type { DB } from "../db/database.js";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const PERMISSION_MODES = ["auto", "confirm", "disabled"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const SettingsSchema = z.object({
  /** Modelo de IA (id del proveedor). */
  model: z.string().min(1).max(100),
  /** Nivel de esfuerzo/razonamiento del modelo. */
  effort: z.enum(EFFORTS),
  /** Cómo quieres que ATLAS te llame. */
  userName: z.string().max(60),
  /** Zona horaria preferida (IANA), p. ej. America/Santiago. Vacío = la del dispositivo. */
  timezone: z.string().max(60),
  /** Permisos por herramienta (sobrescriben el valor por defecto). */
  toolPermissions: z.record(z.string(), z.enum(PERMISSION_MODES)),
});
export type UserSettings = z.infer<typeof SettingsSchema>;

export function defaultSettings(defaultModel: string): UserSettings {
  return { model: defaultModel, effort: "medium", userName: "", timezone: "", toolPermissions: {} };
}

export class SettingsStore {
  constructor(
    private db: DB,
    private defaultModel: string,
  ) {}

  get(userId: number): UserSettings {
    const rows = this.db.prepare("SELECT key, value FROM settings WHERE user_id = ?").all(userId) as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, unknown> = { ...defaultSettings(this.defaultModel) };
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        /* valor corrupto: se ignora y se usa el valor por defecto */
      }
    }
    const parsed = SettingsSchema.safeParse(out);
    return parsed.success ? parsed.data : defaultSettings(this.defaultModel);
  }

  update(userId: number, patch: Partial<UserSettings>): UserSettings {
    const merged = SettingsSchema.parse({ ...this.get(userId), ...patch });
    const stmt = this.db.prepare(
      "INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
    );
    for (const key of Object.keys(patch) as Array<keyof UserSettings>) {
      stmt.run(userId, key, JSON.stringify(merged[key]));
    }
    return merged;
  }
}
