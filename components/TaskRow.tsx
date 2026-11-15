"use client";

import { api, errMsg } from "@/lib/client/api";
import { useToast } from "./ui";
import type { Project, Task } from "@/lib/shared/types";
import { localDate } from "@/lib/shared/time";

export default function TaskRow({
  task,
  projects,
  onChanged,
  actions
}: {
  task: Task;
  projects: Project[];
  onChanged: (t: Task | null) => void;
  actions?: React.ReactNode;
}) {
  const toast = useToast();
  const project = projects.find((p) => p.id === task.project_id);
  const today = localDate();
  const overdue = task.status === "todo" && task.due_date && task.due_date < today;

  const toggle = async () => {
    const next = task.status === "done" ? "todo" : "done";
    onChanged({ ...task, status: next, completed_at: next === "done" ? new Date().toISOString() : null });
    try {
      onChanged(await api<Task>(`/api/tasks/${task.id}`, { method: "PATCH", body: { status: next } }));
    } catch (e) {
      onChanged(task);
      toast({ text: errMsg(e), kind: "bad" });
    }
  };

  return (
    <div className={`task ${task.status === "done" ? "done" : ""}`}>
      <button className={`check ${task.status === "done" ? "on" : ""}`} onClick={() => void toggle()} aria-label={task.status === "done" ? "Mark not done" : "Mark done"}>
        {task.status === "done" ? "✓" : ""}
      </button>
      <div className="grow">
        <div className="task-title ellipsis">{task.title}</div>
        <div className="row tiny muted" style={{ gap: 8 }}>
          {project ? (
            <span className="row" style={{ gap: 4 }}>
              <span className="dot" style={{ background: project.color, width: 7, height: 7 }} /> {project.name}
            </span>
          ) : null}
          {task.due_date ? <span className={overdue ? "bad strong" : ""}>{overdue ? "overdue · " : ""}{fmtDue(task.due_date, today)}</span> : null}
          {task.estimate_min ? <span>~{task.estimate_min}m</span> : null}
        </div>
      </div>
      {actions}
    </div>
  );
}

const fmtDue = (d: string, today: string) => {
  if (d === today) return "today";
  const [y, m, day] = d.split("-").map(Number);
  const date = new Date(y, m - 1, day);
  const diff = Math.round((date.getTime() - new Date(today + "T00:00").getTime()) / 86_400_000);
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};
