import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, formatDate, type Memory, type Project } from "../lib/api";
import { IconEdit, IconPin, IconPlus, IconTrash } from "../components/Icons";
import { useUi } from "../components/ui";

const CAT_ES: Record<string, string> = {
  general: "General",
  preferencia: "Preferencia",
  persona: "Persona",
  proyecto: "Proyecto",
  trabajo: "Trabajo",
  personal: "Personal",
  dato: "Dato",
};

export function MemoryPage() {
  const [tab, setTab] = useState<"memories" | "projects">("memories");
  return (
    <div className="page">
      <div className="row wrap">
        <h2>Memoria</h2>
        <span className="spacer" />
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={tab === "memories"} className={tab === "memories" ? "active" : ""} onClick={() => setTab("memories")}>
            Recuerdos
          </button>
          <button role="tab" aria-selected={tab === "projects"} className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>
            Proyectos
          </button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Lo que ATLAS recuerda de ti, compartido entre tu iPhone y tu computador. Puedes pedirle “recuerda que…” en el chat o añadirlo aquí.
      </p>
      {tab === "memories" ? <Memories /> : <Projects />}
    </div>
  );
}

function Memories() {
  const { toast, confirm } = useUi();
  const [items, setItems] = useState<Memory[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<Partial<Memory> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cat) params.set("category", cat);
    try {
      const r = await api<{ memories: Memory[]; categories: string[] }>(`/api/memories?${params}`);
      setItems(r.memories);
      setCategories(r.categories);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [q, cat, toast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    api<{ projects: Project[] }>("/api/projects").then((r) => setProjects(r.projects)).catch(() => {});
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing?.content?.trim()) return;
    const body = { content: editing.content, category: editing.category || "general", projectId: editing.project_id ?? null, pinned: !!editing.pinned };
    try {
      if (editing.id) await api(`/api/memories/${editing.id}`, { method: "PATCH", body });
      else await api("/api/memories", { method: "POST", body });
      setEditing(null);
      toast("Recuerdo guardado.");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function remove(m: Memory) {
    if (!(await confirm({ title: "¿Eliminar este recuerdo?", body: m.content, confirmText: "Eliminar", danger: true }))) return;
    try {
      await api(`/api/memories/${m.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function togglePin(m: Memory) {
    await api(`/api/memories/${m.id}`, { method: "PATCH", body: { pinned: !m.pinned } }).catch((e) => toast(e.message, "error"));
    load();
  }

  return (
    <>
      <div className="row wrap">
        <input className="input" style={{ flex: "1 1 220px" }} placeholder="Buscar recuerdos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ flex: "0 1 170px" }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CAT_ES[c] ?? c}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => setEditing({ category: "general" })}>
          <IconPlus width={18} /> Añadir
        </button>
      </div>

      {editing && (
        <form className="card stack" onSubmit={save}>
          <h3>{editing.id ? `Editar recuerdo #${editing.id}` : "Nuevo recuerdo"}</h3>
          <textarea
            className="textarea"
            autoFocus
            placeholder="Ej.: Mi empresa se llama PYC Consultoría Integral."
            value={editing.content ?? ""}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          />
          <div className="grid2">
            <label className="field">
              Categoría
              <select className="select" value={editing.category ?? "general"} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {CAT_ES[c] ?? c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Proyecto
              <select
                className="select"
                value={editing.project_id ?? ""}
                onChange={(e) => setEditing({ ...editing, project_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Ninguno</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={!!editing.pinned} onChange={(e) => setEditing({ ...editing, pinned: e.target.checked ? 1 : 0 })} />
            <span>
              Fijar <small>ATLAS lo tendrá siempre presente en cada conversación.</small>
            </span>
          </label>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <span className="spacer" />
            <button className="btn primary" type="submit">
              Guardar
            </button>
          </div>
        </form>
      )}

      <div className="list">
        {items.map((m) => (
          <div key={m.id} className="item">
            <div className="body">
              <div>{m.content}</div>
              <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                <span className="badge cyan">{CAT_ES[m.category] ?? m.category}</span>
                {m.project_name && <span className="badge">{m.project_name}</span>}
                {!!m.pinned && <span className="badge warn">Fijado</span>}
                <span className="faint small">
                  #{m.id} · {m.source === "atlas" ? "guardado por ATLAS" : "añadido por ti"} · {formatDate(m.updated_at)}
                </span>
              </div>
            </div>
            <div className="actions">
              <button className={`icon-btn ${m.pinned ? "active" : ""}`} aria-label={m.pinned ? "Desfijar" : "Fijar"} onClick={() => togglePin(m)}>
                <IconPin />
              </button>
              <button className="icon-btn" aria-label="Editar" onClick={() => setEditing(m)}>
                <IconEdit />
              </button>
              <button className="icon-btn" aria-label="Eliminar" onClick={() => remove(m)}>
                <IconTrash />
              </button>
            </div>
          </div>
        ))}
        {!loading && !items.length && <div className="empty">{q || cat ? "No hay recuerdos que coincidan." : "ATLAS aún no tiene recuerdos guardados."}</div>}
      </div>
    </>
  );
}

function Projects() {
  const { toast, confirm } = useUi();
  const [items, setItems] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(() => {
    api<{ projects: Project[] }>("/api/projects?all=1").then((r) => setItems(r.projects)).catch((e) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/projects", { method: "POST", body: { name, description } });
      setName("");
      setDescription("");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function toggleArchive(p: Project) {
    await api(`/api/projects/${p.id}`, { method: "PATCH", body: { status: p.status === "active" ? "archived" : "active" } }).catch((e) =>
      toast(e.message, "error"),
    );
    load();
  }

  async function remove(p: Project) {
    const ok = await confirm({
      title: `¿Eliminar el proyecto "${p.name}"?`,
      body: "Los recuerdos, tareas y conversaciones asociados se conservan, pero quedarán sin proyecto.",
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    await api(`/api/projects/${p.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
    load();
  }

  return (
    <>
      <form className="card stack" onSubmit={create}>
        <h3>Nuevo proyecto</h3>
        <div className="grid2">
          <input className="input" placeholder="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" placeholder="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="row">
          <span className="spacer" />
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            <IconPlus width={18} /> Crear
          </button>
        </div>
      </form>
      <div className="list">
        {items.map((p) => (
          <div key={p.id} className="item">
            <div className="body">
              <div className="row wrap" style={{ gap: 8 }}>
                <strong>{p.name}</strong>
                <span className={`badge ${p.status === "active" ? "ok" : ""}`}>{p.status === "active" ? "Activo" : "Archivado"}</span>
              </div>
              {p.description && <div className="muted small">{p.description}</div>}
            </div>
            <div className="actions">
              <button className="btn small ghost" onClick={() => toggleArchive(p)}>
                {p.status === "active" ? "Archivar" : "Reactivar"}
              </button>
              <button className="icon-btn" aria-label="Eliminar" onClick={() => remove(p)}>
                <IconTrash />
              </button>
            </div>
          </div>
        ))}
        {!items.length && <div className="empty">Aún no hay proyectos.</div>}
      </div>
    </>
  );
}
