"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import TaskRow from "@/components/TaskRow";
import { useToast } from "@/components/ui";
import { api, errMsg } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { addDays, localDate } from "@/lib/shared/time";
import type { Project, Task } from "@/lib/shared/types";

const COLORS = ["#3b5bdb", "#d6336c", "#0c8599", "#f08c00", "#2f9e44", "#7048e8", "#e8590c", "#495057"];

export default function TasksPage() {
  const catalog = useCatalog();
  const toast = useToast();
  const today = localDate();
  const [filter, setFilter] = useState<string>("all");

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [due, setDue] = useState(today);
  const [estimate, setEstimate] = useState("");

  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const t = await api<Task>("/api/tasks", {
        body: { title: title.trim(), project_id: projectId || null, due_date: due || null, estimate_min: estimate ? Number(estimate) : null }
      });
      catalog.setTasks((xs) => [...(xs ?? []), t]);
      setTitle("");
      setEstimate("");
    } catch (err) {
      toast({ text: errMsg(err), kind: "bad" });
    }
  };

  const remove = async (t: Task) => {
    catalog.setTasks((xs) => xs?.filter((x) => x.id !== t.id));
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      toast({ text: `Deleted “${t.title}”` });
    } catch (err) {
      toast({ text: errMsg(err), kind: "bad" });
      void catalog.reloadTasks();
    }
  };

  const shown = catalog.tasks.filter((t) => filter === "all" || (filter === "none" ? !t.project_id : t.project_id === filter));
  const todo = shown.filter((t) => t.status === "todo");
  const groups: [string, Task[]][] = [
    ["Overdue", todo.filter((t) => t.due_date && t.due_date < today)],
    ["Today", todo.filter((t) => t.due_date === today)],
    ["Tomorrow", todo.filter((t) => t.due_date === addDays(today, 1))],
    ["Later", todo.filter((t) => t.due_date && t.due_date > addDays(today, 1)).sort((a, b) => a.due_date!.localeCompare(b.due_date!))],
    ["Someday", todo.filter((t) => !t.due_date)],
    ["Done (last 14 days)", shown.filter((t) => t.status === "done").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))]
  ];

  const update = (id: string, t: Task | null) => catalog.setTasks((xs) => (t ? xs?.map((x) => (x.id === id ? t : x)) : xs?.filter((x) => x.id !== id)));

  return (
    <main className="page">
      <div className="page-head">
        <h1>Tasks</h1>
      </div>
      <div className="grid-today">
        <section className="card">
          <form className="fields" onSubmit={addTask} style={{ marginBottom: 16 }}>
            <input placeholder="New task…" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="fields-3">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
                <option value="">No project</option>
                {catalog.activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
              <input type="number" min={5} step={5} placeholder="Est. min" value={estimate} onChange={(e) => setEstimate(e.target.value)} aria-label="Estimate in minutes" />
            </div>
            <button className="primary" disabled={!title.trim()}>
              Add task
            </button>
          </form>
          <div className="row wrap" style={{ marginBottom: 8 }}>
            <div className="seg" style={{ flexWrap: "wrap" }}>
              <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
                All
              </button>
              {catalog.activeProjects.map((p) => (
                <button key={p.id} className={filter === p.id ? "on" : ""} onClick={() => setFilter(p.id)}>
                  <span className="dot" style={{ background: p.color }} /> {p.name}
                </button>
              ))}
              <button className={filter === "none" ? "on" : ""} onClick={() => setFilter("none")}>
                No project
              </button>
            </div>
          </div>
          {catalog.loaded && !shown.length ? <div className="empty">No tasks yet.</div> : null}
          {groups.map(([name, list]) =>
            list.length ? (
              <div key={name}>
                <div className={`group-title ${name === "Overdue" ? "bad" : ""}`}>
                  {name} · {list.length}
                </div>
                {list.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    projects={catalog.projects}
                    onChanged={(n) => update(t.id, n)}
                    actions={
                      <div className="row" style={{ gap: 2 }}>
                        {t.status === "todo" ? (
                          <Link href={`/plan?date=${t.due_date && t.due_date >= today ? t.due_date : today}&task=${t.id}`}>
                            <button className="ghost sm" title="Put this on your calendar">
                              Schedule
                            </button>
                          </Link>
                        ) : null}
                        <button className="ghost sm" onClick={() => void remove(t)} aria-label={`Delete ${t.title}`}>
                          ✕
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            ) : null
          )}
        </section>
        <ProjectsCard
          projects={catalog.projects}
          tasks={catalog.tasks}
          reload={catalog.reloadProjects}
          onDeleted={(id) => {
            if (filter === id) setFilter("all");
            void catalog.reloadTasks();
          }}
        />
      </div>
    </main>
  );
}

function ProjectsCard({
  projects,
  tasks,
  reload,
  onDeleted
}: {
  projects: Project[];
  tasks: Task[];
  reload: () => Promise<void>;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [alsoTasks, setAlsoTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[projects.length % COLORS.length]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api("/api/projects", { body: { name: name.trim(), color } });
      setName("");
      setColor(COLORS[(projects.length + 1) % COLORS.length]);
      await reload();
    } catch (err) {
      toast({ text: errMsg(err), kind: "bad" });
    }
  };
  const archive = async (p: Project) => {
    await api(`/api/projects/${p.id}`, { method: "PATCH", body: { archived: !p.archived_at } });
    await reload();
  };
  const remove = async (p: Project) => {
    setBusy(true);
    try {
      const res = await api<{ tasks_deleted: number }>(`/api/projects/${p.id}${alsoTasks ? "?delete_tasks=1" : ""}`, { method: "DELETE" });
      toast({ text: `Deleted “${p.name}”${res.tasks_deleted ? ` and ${res.tasks_deleted} task${res.tasks_deleted === 1 ? "" : "s"}` : ""}` });
      setDeleting(null);
      setAlsoTasks(false);
      await reload();
      onDeleted(p.id);
    } catch (err) {
      toast({ text: errMsg(err), kind: "bad" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Projects</h2>
      </div>
      <p className="muted small" style={{ marginBottom: 12 }}>Group work into projects (e.g. DSA, System design, AWS) so reports can show where your time goes.</p>
      {projects.map((p) => (
        <div key={p.id} className="task" style={{ opacity: p.archived_at ? 0.5 : 1 }}>
          <span className="dot" style={{ background: p.color, width: 12, height: 12 }} />
          <span className="grow">{p.name}</span>
          <button className="ghost sm" onClick={() => void archive(p)}>
            {p.archived_at ? "Restore" : "Archive"}
          </button>
          <button
            className="ghost sm"
            onClick={() => {
              setDeleting(deleting?.id === p.id ? null : p);
              setAlsoTasks(false);
            }}
            aria-label={`Delete ${p.name}`}
            title="Delete project"
          >
            ✕
          </button>
        </div>
      ))}
      {deleting ? (
        <div className="callout bad stack" style={{ marginTop: 10 }}>
          <span className="small">
            Delete <strong>{deleting.name}</strong> permanently? Its planned blocks and tracked time stay (your report totals don&apos;t change) but
            will show as “No project”. This can&apos;t be undone. Tip: <em>Archive</em> hides it but keeps everything.
          </span>
          {(() => {
            const n = tasks.filter((t) => t.project_id === deleting.id && t.status === "todo").length;
            return (
              <label className="inline small">
                <input type="checkbox" checked={alsoTasks} onChange={(e) => setAlsoTasks(e.target.checked)} />
                Also delete its tasks{n ? ` (${n} open)` : ""}, otherwise they move to “No project”
              </label>
            );
          })()}
          <div className="row">
            <button className="danger sm" disabled={busy} onClick={() => void remove(deleting)}>
              Delete project
            </button>
            <button className="ghost sm" onClick={() => setDeleting(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <form className="row" onSubmit={add} style={{ marginTop: 12 }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Project colour" />
        <input placeholder="New project" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name.trim()}>Add</button>
      </form>
    </section>
  );
}
