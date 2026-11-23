import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Task } from "../lib/api";
import { IconCheck, IconCircle, IconPlus, IconTrash } from "../components/Icons";
import { useUi } from "../components/ui";

const FILTERS = [
  { id: "open", label: "Pendientes" },
  { id: "done", label: "Hechas" },
  { id: "", label: "Todas" },
] as const;

const STATUS_ES: Record<Task["status"], string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Hecha",
  cancelled: "Cancelada",
};

function dueLabel(due: string | null) {
  if (!due) return null;
  const d = new Date(due.length <= 10 ? `${due}T12:00:00` : due);
  if (Number.isNaN(d.getTime())) return due;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  const text = d.toLocaleDateString("es-419", { weekday: "short", day: "numeric", month: "short" });
  return { text: diff === 0 ? "Hoy" : diff === 1 ? "Mañana" : text, overdue: diff < 0 };
}

export function TasksPage() {
  const { toast, confirm } = useUi();
  const [filter, setFilter] = useState<string>("open");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api<{ tasks: Task[] }>(`/api/tasks${filter ? `?status=${filter}` : ""}`)
      .then((r) => setTasks(r.tasks))
      .catch((e) => toast(e.message, "error"))
      .finally(() => setLoading(false));
  }, [filter, toast]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api("/api/tasks", { method: "POST", body: { title, dueAt: due || null } });
      setTitle("");
      setDue("");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function setStatus(t: Task, status: Task["status"]) {
    await api(`/api/tasks/${t.id}`, { method: "PATCH", body: { status } }).catch((e) => toast(e.message, "error"));
    load();
  }

  async function remove(t: Task) {
    if (!(await confirm({ title: "¿Eliminar la tarea?", body: t.title, confirmText: "Eliminar", danger: true }))) return;
    await api(`/api/tasks/${t.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
    load();
  }

  return (
    <div className="page">
      <div className="row wrap">
        <h2>Tareas</h2>
        <span className="spacer" />
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <form className="row wrap" onSubmit={add}>
        <input className="input" style={{ flex: "1 1 240px" }} placeholder="Nueva tarea…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" style={{ flex: "0 1 170px" }} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fecha límite" />
        <button className="btn primary" type="submit" disabled={!title.trim()}>
          <IconPlus width={18} /> Añadir
        </button>
      </form>
      <p className="faint small" style={{ margin: 0 }}>
        También puedes decirle a ATLAS: “crea una tarea para el viernes: enviar la propuesta”.
      </p>

      <div className="list">
        {tasks.map((t) => {
          const d = dueLabel(t.due_at);
          const done = t.status === "done";
          return (
            <div key={t.id} className={`item ${done ? "done" : ""}`}>
              <button
                className={`icon-btn ${done ? "active" : ""}`}
                aria-label={done ? "Marcar como pendiente" : "Marcar como hecha"}
                onClick={() => setStatus(t, done ? "pending" : "done")}
              >
                {done ? <IconCheck /> : <IconCircle />}
              </button>
              <div className="body">
                <div className="title">{t.title}</div>
                {t.notes && <div className="muted small">{t.notes}</div>}
                <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                  {t.status === "in_progress" && <span className="badge cyan">En curso</span>}
                  {t.status === "cancelled" && <span className="badge">Cancelada</span>}
                  {d && typeof d === "object" && <span className={`badge ${d.overdue && !done ? "danger" : ""}`}>{d.text}</span>}
                  {t.project_name && <span className="badge">{t.project_name}</span>}
                </div>
              </div>
              <div className="actions">
                {!done && t.status !== "in_progress" && (
                  <button className="btn small ghost" onClick={() => setStatus(t, "in_progress")} title={STATUS_ES.in_progress}>
                    Iniciar
                  </button>
                )}
                <button className="icon-btn" aria-label="Eliminar" onClick={() => remove(t)}>
                  <IconTrash />
                </button>
              </div>
            </div>
          );
        })}
        {!loading && !tasks.length && <div className="empty">{filter === "open" ? "No tienes tareas pendientes. 🎉" : "No hay tareas."}</div>}
      </div>
    </div>
  );
}
