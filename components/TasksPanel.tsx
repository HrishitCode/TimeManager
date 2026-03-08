"use client";

import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { Project, Task, TaskKind, TaskStatus } from "@/types/domain";

interface Props {
  token: string;
  projects: Project[];
  tasks: Task[];
  onRefresh: () => Promise<void>;
}

export default function TasksPanel({ token, projects, tasks, onRefresh }: Props) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("future");
  const [scheduledFor, setScheduledFor] = useState("");

  const sorted = useMemo(() => [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)), [tasks]);

  const createTask = async () => {
    if (!projectId || !title.trim()) {
      return;
    }
    await apiFetch<Task>("/api/tasks", token, {
      method: "POST",
      body: JSON.stringify({
        projectId,
        title,
        kind,
        scheduledFor: scheduledFor || null
      })
    });
    setTitle("");
    setScheduledFor("");
    await onRefresh();
  };

  const updateStatus = async (taskId: string, status: TaskStatus) => {
    await apiFetch<Task>(`/api/tasks/${taskId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await onRefresh();
  };

  return (
    <section className="card">
      <h2>Tasks</h2>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <div style={{ minWidth: 180, flex: 1 }}>
          <label>Project</label>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 180, flex: 2 }}>
          <label>Task title</label>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task" />
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 8 }}>
        <div style={{ minWidth: 130 }}>
          <label>Kind</label>
          <select value={kind} onChange={(event) => setKind(event.target.value as TaskKind)}>
            <option value="future">Future</option>
            <option value="daily">Daily</option>
          </select>
        </div>
        <div style={{ minWidth: 160, flex: 1 }}>
          <label>Schedule (optional)</label>
          <input type="date" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
        </div>
        <div style={{ alignSelf: "end" }}>
          <button className="primary" onClick={createTask}>
            Add task
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {sorted.map((task) => (
          <div key={task.id} className="row wrap" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{task.title}</strong>
              <p className="muted">
                {task.kind} {task.scheduled_for ? `| ${task.scheduled_for}` : ""}
              </p>
            </div>
            <div className="row">
              <button className="ghost" onClick={() => updateStatus(task.id, "done")}>Done</button>
              <button className="ghost" onClick={() => updateStatus(task.id, "skipped")}>Skip</button>
              <button className="ghost" onClick={() => updateStatus(task.id, "todo")}>Todo</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
