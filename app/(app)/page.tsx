"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import BlockEditor from "@/components/BlockEditor";
import { useMe, usePeople } from "@/components/MeContext";
import TaskRow from "@/components/TaskRow";
import TimerCard from "@/components/TimerCard";
import { Avatar, Modal, useToast } from "@/components/ui";
import { api, errMsg, useApi, useNow } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { fmtDuration, fmtTime, localDate } from "@/lib/shared/time";
import type { Block, MemberStatus, Task, WorkspaceReport } from "@/lib/shared/types";

export default function TodayPage() {
  const { me } = useMe();
  const people = usePeople();
  const catalog = useCatalog();
  const now = useNow(30_000);
  const today = localDate(new Date(now));

  const range = useMemo(() => {
    const s = new Date(`${today}T00:00`);
    return `from=${s.toISOString()}&to=${new Date(s.getTime() + 86_400_000).toISOString()}`;
  }, [today]);
  const blocks = useApi<Block[]>(`/api/blocks?${range}`, { refreshMs: 60_000 });
  const status = useApi<MemberStatus[]>("/api/status", { refreshMs: 15_000 });
  const report = useApi<WorkspaceReport>(`/api/reports?period=day&date=${today}`, { refreshMs: 60_000 });
  const [open, setOpen] = useState<Block | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const myBlocks = (blocks.data ?? []).filter((b) => b.participants.some((p) => p.user_id === me.user.id && p.status !== "declined"));
  const current = myBlocks.find(
    (b) => b.participants.some((p) => p.user_id === me.user.id && p.status === "accepted") && new Date(b.starts_at).getTime() <= now && new Date(b.ends_at).getTime() > now
  ) ?? null;
  const myReport = report.data?.members.find((m) => m.user_id === me.user.id);

  const refreshAll = () => {
    void status.reload();
    void report.reload();
    void blocks.reload();
  };

  const greeting = (() => {
    const h = new Date(now).getHours();
    return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {me.user.name.split(" ")[0]}
          </h1>
          <p className="muted small">{new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <div className="row">
          <button className="sm" onClick={() => setLogOpen(true)}>
            + Log time
          </button>
          <Link href={`/plan?date=${today}`}>
            <button className="sm">Plan</button>
          </Link>
        </div>
      </div>

      <div className="grid-today">
        <div className="stack-lg">
          <TimerCard projects={catalog.projects} tasks={catalog.tasks} currentBlock={current} onChange={refreshAll} />

          <section className="card">
            <div className="card-head">
              <h2>Today&apos;s plan</h2>
              {myReport && myReport.planned_min + myReport.upcoming_min > 0 ? (
                <span className="muted small num">
                  {fmtDuration(myReport.planned_min + myReport.upcoming_min)} planned · {fmtDuration(myReport.on_plan_min)} done on plan
                </span>
              ) : null}
            </div>
            {blocks.data && !myBlocks.length ? (
              <div className="empty">
                Nothing planned yet. <Link className="link" href={`/plan?date=${today}`}>Plan your day →</Link>
              </div>
            ) : null}
            {myBlocks.map((b) => {
              const s = new Date(b.starts_at).getTime();
              const e = new Date(b.ends_at).getTime();
              const state = now >= e ? "past" : now >= s ? "now" : "";
              const outcome = myReport?.blocks.find((o) => o.block_id === b.id);
              const invited = b.participants.find((p) => p.user_id === me.user.id)?.status === "invited";
              const others = b.participants.filter((p) => p.user_id !== me.user.id && p.status !== "declined");
              return (
                <div key={b.id} className={`agenda-item ${state}`} onClick={() => setOpen(b)} style={{ cursor: "pointer" }}>
                  <div className="agenda-time">
                    {fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}
                  </div>
                  <div className="agenda-bar" style={{ background: b.project_color ?? "var(--p1)" }} />
                  <div className="grow">
                    <div className="strong ellipsis">{b.title}</div>
                    {others.length ? <div className="tiny muted">with {others.map((p) => p.name).join(", ")}</div> : null}
                  </div>
                  {invited ? (
                    <span className="chip accent">invited</span>
                  ) : outcome && state === "past" ? (
                    <span className={`chip ${outcome.attended_pct >= 80 ? "good" : outcome.attended_pct >= 20 ? "warn" : "bad"}`}>
                      {Math.round(outcome.attended_pct)}%
                    </span>
                  ) : state === "now" ? (
                    <span className="chip accent">now</span>
                  ) : null}
                </div>
              );
            })}
          </section>
        </div>

        <div className="stack-lg">
          <LiveCard statuses={status.data} report={report.data} people={people} />
          <TodayTasks tasks={catalog.tasks} projects={catalog.projects} setTasks={catalog.setTasks} today={today} onChanged={() => void report.reload()} />
        </div>
      </div>

      {open ? (
        <BlockEditor block={open} projects={catalog.projects} tasks={catalog.tasks} onClose={() => setOpen(null)} onSaved={refreshAll} />
      ) : null}
      {logOpen ? <ManualLog onClose={() => setLogOpen(false)} onSaved={refreshAll} projects={catalog.activeProjects} /> : null}
    </main>
  );
}

function LiveCard({ statuses, report, people }: { statuses?: MemberStatus[]; report?: WorkspaceReport; people: ReturnType<typeof usePeople> }) {
  const { me } = useMe();
  const now = useNow(15_000);
  const [perm, setPerm] = useState<string>("granted");
  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
  }, []);

  return (
    <section className="card">
      <div className="card-head">
        <h2>{me.workspace ? me.workspace.name : "Right now"}</h2>
        {!me.workspace ? (
          <Link className="link small" href="/together">
            Invite a partner →
          </Link>
        ) : null}
      </div>
      <div className="stack">
        {people.map((p) => {
          const s = statuses?.find((x) => x.user_id === p.id);
          const r = report?.members.find((m) => m.user_id === p.id);
          const t = s?.timer;
          const what = t ? t.label || t.task_title || t.project_name || (t.mode === "break" ? "Break" : "Focus") : null;
          const sinceMin = t?.segment_started_at ? Math.max(0, (now - new Date(t.segment_started_at).getTime()) / 60_000) : 0;
          return (
            <div key={p.id} className="person">
              <Avatar name={p.name} color={p.color} />
              <div className="grow">
                <div className="row between">
                  <span className="strong">{p.label}</span>
                  {r ? <span className="chip num" title="Today's score">{r.score}</span> : null}
                </div>
                <div className="small muted ellipsis">
                  {t ? (
                    t.status === "running" ? (
                      <span>
                        <span className="dot pulse" style={{ background: t.mode === "break" ? "var(--warn)" : "var(--good)", marginRight: 6 }} />
                        {t.mode === "break" ? "On a break" : what} · {fmtDuration(sinceMin)}
                      </span>
                    ) : (
                      <span>Paused · {what}</span>
                    )
                  ) : s?.current_block ? (
                    <span className="warn">Planned “{s.current_block.title}” but not tracking</span>
                  ) : (
                    "Not tracking"
                  )}
                </div>
                <div className="tiny muted num">
                  {fmtDuration(s?.focus_today_min ?? 0)} focused today
                  {r && r.planned_min > 0 ? ` · ${Math.round(r.adherence_pct)}% on plan` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {perm === "default" ? (
        <button className="sm ghost" style={{ marginTop: 10 }} onClick={() => void Notification.requestPermission().then(setPerm)}>
          🔔 Enable block reminders
        </button>
      ) : null}
    </section>
  );
}

function TodayTasks({
  tasks,
  projects,
  setTasks,
  today,
  onChanged
}: {
  tasks: Task[];
  projects: ReturnType<typeof useCatalog>["projects"];
  setTasks: (fn: (t: Task[] | undefined) => Task[] | undefined) => void;
  today: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const visible = tasks.filter(
    (t) => (t.status === "todo" && t.due_date && t.due_date <= today) || (t.status === "done" && t.completed_at && localDate(new Date(t.completed_at)) === today)
  );
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const t = await api<Task>("/api/tasks", { body: { title: title.trim(), due_date: today } });
      setTasks((xs) => [...(xs ?? []), t]);
      setTitle("");
    } catch (err) {
      toast({ text: errMsg(err), kind: "bad" });
    }
  };
  const update = (t: Task | null, id: string) => {
    setTasks((xs) => (t ? xs?.map((x) => (x.id === id ? t : x)) : xs?.filter((x) => x.id !== id)));
    onChanged();
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Due today</h2>
        <Link className="link small" href="/tasks">
          All tasks →
        </Link>
      </div>
      {visible.length ? (
        visible.map((t) => <TaskRow key={t.id} task={t} projects={projects} onChanged={(n) => update(n, t.id)} />)
      ) : (
        <p className="muted small" style={{ marginBottom: 8 }}>Nothing due. Add what you want to finish today:</p>
      )}
      <form onSubmit={add} className="row" style={{ marginTop: 10 }}>
        <input placeholder="Add a task for today…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button disabled={!title.trim()}>Add</button>
      </form>
    </section>
  );
}

function ManualLog({ onClose, onSaved, projects }: { onClose: () => void; onSaved: () => void; projects: ReturnType<typeof useCatalog>["projects"] }) {
  const toast = useToast();
  const [date, setDate] = useState(localDate());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const [y, m, d] = date.split("-").map(Number);
    const at = (t: string, plus = 0) => {
      const [h, mi] = t.split(":").map(Number);
      return new Date(y, m - 1, d + plus, h, mi).toISOString();
    };
    try {
      await api("/api/entries", {
        body: { started_at: at(start), ended_at: at(end, end <= start ? 1 : 0), label: label.trim() || null, project_id: projectId || null, mode }
      });
      toast({ text: "Logged" });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <Modal title="Log time you forgot to track" onClose={onClose}>
      <form className="fields" onSubmit={submit}>
        <p className="muted small">Honest logging keeps the reports meaningful — including breaks.</p>
        <div className="fields-3">
          <div>
            <label>Day</label>
            <input type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label>From</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div>
            <label>To</label>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
        </div>
        <input placeholder="What did you do?" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="fields-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="seg" style={{ justifySelf: "start" }}>
            <button type="button" className={mode === "focus" ? "on" : ""} onClick={() => setMode("focus")}>
              Focus
            </button>
            <button type="button" className={mode === "break" ? "on" : ""} onClick={() => setMode("break")}>
              Break
            </button>
          </div>
        </div>
        {error ? <div className="callout bad">{error}</div> : null}
        <button className="primary">Save entry</button>
      </form>
    </Modal>
  );
}
