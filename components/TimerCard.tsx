"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, errMsg, useApi, useNow } from "@/lib/client/api";
import { fmtClock, fmtTime } from "@/lib/shared/time";
import { useToast } from "./ui";
import { useMe } from "./MeContext";
import type { Block, Project, Task, Timer } from "@/lib/shared/types";

interface Props {
  projects: Project[];
  tasks: Task[];
  currentBlock: Block | null;
  onChange?: () => void;
}

const PRESETS = [
  { label: "25m", sec: 25 * 60 },
  { label: "50m", sec: 50 * 60 },
  { label: "90m", sec: 90 * 60 },
  { label: "Open", sec: null }
];

export default function TimerCard({ projects, tasks, currentBlock, onChange }: Props) {
  const toast = useToast();
  const { me } = useMe();
  // Poll so a start/pause on your phone shows up on your laptop within seconds.
  const { data, setData, reload } = useApi<{ timer: Timer | null; server_now: string }>("/api/timer", { refreshMs: 5000 });
  const skew = useRef(0);
  useEffect(() => {
    if (data) skew.current = new Date(data.server_now).getTime() - Date.now();
  }, [data]);
  const now = useNow(1000) + skew.current;
  const timer = data?.timer ?? null;

  const [label, setLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [planned, setPlanned] = useState<number | null>(25 * 60);
  const [include, setInclude] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stopAt, setStopAt] = useState<string | null>(null);

  const projectTasks = tasks.filter((t) => t.status === "todo" && (!projectId || t.project_id === projectId));

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await api<{ timer: Timer | null; server_now: string }>("/api/timer", { body });
      setData(res);
      setStopAt(null);
      onChange?.();
      return res;
    } catch (e) {
      if (e instanceof ApiError && e.data.needs_stop_time) {
        setStopAt(defaultStopValue(timer));
      }
      toast({ text: errMsg(e), kind: "bad" });
      void reload();
    } finally {
      setBusy(false);
    }
  };

  const startFromForm = () =>
    act({
      action: "start",
      label: label.trim() || null,
      project_id: projectId || null,
      task_id: taskId || null,
      mode,
      planned_sec: planned,
      include_in_reports: include
    });

  const startBlock = (b: Block) =>
    act({
      action: "start",
      block_id: b.id,
      label: b.title,
      // A partner's block references *their* project/task, which aren't yours to track against.
      project_id: b.owner_id === me.user.id ? b.project_id : null,
      task_id: b.owner_id === me.user.id ? b.task_id : null,
      mode: "focus",
      planned_sec: Math.max(60, Math.round((new Date(b.ends_at).getTime() - now) / 1000))
    });

  const elapsed = useMemo(() => {
    if (!timer) return 0;
    const seg = timer.status === "running" && timer.segment_started_at ? (now - new Date(timer.segment_started_at).getTime()) / 1000 : 0;
    return timer.accumulated_sec + Math.max(0, seg);
  }, [timer, now]);

  const title = timer
    ? timer.label ||
      tasks.find((t) => t.id === timer.task_id)?.title ||
      projects.find((p) => p.id === timer.project_id)?.name ||
      (timer.mode === "break" ? "Break" : "Focus")
    : null;
  const project = projects.find((p) => p.id === timer?.project_id);

  // Tab title shows the clock — handy when you're in another tab.
  useEffect(() => {
    if (!timer) {
      document.title = "Time Manager";
      return;
    }
    const remaining = timer.planned_sec ? timer.planned_sec - elapsed : null;
    const clock = remaining !== null ? (remaining >= 0 ? fmtClock(remaining) : `+${fmtClock(-remaining)}`) : fmtClock(elapsed);
    document.title = `${timer.status === "paused" ? "⏸ " : ""}${clock} · ${title}`;
  }, [timer, elapsed, title]);

  if (!data) return <section className="card" style={{ minHeight: 220 }} />;

  if (timer) {
    const remaining = timer.planned_sec ? timer.planned_sec - elapsed : null;
    const over = remaining !== null && remaining < 0;
    const pct = timer.planned_sec ? Math.min(100, (elapsed / timer.planned_sec) * 100) : 0;
    const onBlock = timer.block_id && currentBlock?.id === timer.block_id;
    return (
      <section className="card stack" style={{ gap: 14 }}>
        <div className="row between">
          <span className={`chip ${timer.status === "running" ? (timer.mode === "break" ? "warn" : "good") : ""}`}>
            {timer.status === "running" ? <span className="dot pulse" style={{ background: "currentColor" }} /> : null}
            {timer.status === "paused" ? "Paused" : timer.mode === "break" ? "On a break" : "Focusing"}
          </span>
          <span className="muted small num">since {fmtTime(timer.session_started_at)}</span>
        </div>
        <div>
          <h2 className="ellipsis" style={{ fontSize: "1.25rem" }}>{title}</h2>
          <p className="muted small row" style={{ marginTop: 2 }}>
            {project ? (
              <>
                <span className="dot" style={{ background: project.color }} /> {project.name}
              </>
            ) : null}
            {onBlock ? <span className="chip accent">on plan</span> : null}
            <button
              className={`chip ${timer.include_in_reports ? "" : "warn"}`}
              style={{ border: 0, cursor: "pointer" }}
              title="Tap to change whether this session counts in reports"
              disabled={busy}
              onClick={() => void act({ action: "set_include", include_in_reports: !timer.include_in_reports })}
            >
              {timer.include_in_reports ? "counts in reports" : "not counted"}
            </button>
          </p>
        </div>
        <div>
          <div className={`timer-clock ${over ? "warn" : ""}`}>
            {remaining === null ? fmtClock(elapsed) : over ? `+${fmtClock(-remaining)}` : fmtClock(remaining)}
          </div>
          <p className="muted small num" style={{ marginTop: 6 }}>
            {remaining === null ? "elapsed" : over ? `over the planned ${Math.round(timer.planned_sec! / 60)}m — keep going or stop` : `left of ${Math.round(timer.planned_sec! / 60)}m · ${fmtClock(elapsed)} done`}
          </p>
        </div>
        {timer.planned_sec ? (
          <div className={`progress ${over ? "over" : ""}`}>
            <div style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <div className="row wrap">
          {timer.status === "running" ? (
            <button className="dark lg" onClick={() => void act({ action: "pause" })} disabled={busy}>
              Pause
            </button>
          ) : (
            <button className="primary lg" onClick={() => void act({ action: "resume" })} disabled={busy}>
              Resume
            </button>
          )}
          <button className="lg" onClick={() => void act({ action: "stop" })} disabled={busy}>
            Stop &amp; save
          </button>
          {timer.status === "running" ? (
            <button className="ghost sm" onClick={() => setStopAt(stopAt === null ? defaultStopValue(timer) : null)}>
              Forgot to stop?
            </button>
          ) : null}
        </div>
        {stopAt !== null ? (
          <div className="callout warn row wrap">
            <span className="small">I actually stopped at</span>
            <input type="time" value={stopAt} onChange={(e) => setStopAt(e.target.value)} style={{ width: 120 }} />
            <button className="sm dark" disabled={busy} onClick={() => void act({ action: "stop", at: stopAtIso(stopAt, timer) })}>
              Save
            </button>
          </div>
        ) : null}
        {!onBlock && currentBlock && timer.mode === "focus" ? (
          <div className="callout row between wrap">
            <span className="small">
              Planned now: <strong>{currentBlock.title}</strong>
            </span>
            <button className="sm" onClick={() => void startBlock(currentBlock)} disabled={busy}>
              Switch to it
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card stack" style={{ gap: 14 }}>
      <div className="row between">
        <h2>Start tracking</h2>
        <div className="seg">
          <button className={mode === "focus" ? "on" : ""} onClick={() => setMode("focus")}>
            Focus
          </button>
          <button className={mode === "break" ? "on" : ""} onClick={() => setMode("break")}>
            Break
          </button>
        </div>
      </div>
      {currentBlock ? (
        <div className="callout row between wrap">
          <span className="small">
            You planned <strong>{currentBlock.title}</strong> until {fmtTime(currentBlock.ends_at)}
          </span>
          <button className="primary sm" onClick={() => void startBlock(currentBlock)} disabled={busy}>
            ▶ Start it now
          </button>
        </div>
      ) : null}
      <input placeholder="What are you working on?" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void startFromForm()} />
      <div className="fields-2">
        <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }} aria-label="Project">
          <option value="">No project</option>
          {projects.filter((p) => !p.archived_at).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Task">
          <option value="">No task</option>
          {projectTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>
      <label className="inline small">
        <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
        Count in reports
      </label>
      <div className="row between wrap">
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.label} className={planned === p.sec ? "on" : ""} onClick={() => setPlanned(p.sec)}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="primary lg" onClick={() => void startFromForm()} disabled={busy}>
          ▶ Start
        </button>
      </div>
    </section>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const defaultStopValue = (t: Timer | null) => {
  const d = t?.segment_started_at ? new Date(Math.min(Date.now(), new Date(t.segment_started_at).getTime() + 60 * 60_000)) : new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** "18:40" → the most recent such instant after the segment start. */
const stopAtIso = (hhmm: string, t: Timer) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  const segStart = t.segment_started_at ? new Date(t.segment_started_at).getTime() : 0;
  if (d.getTime() < segStart) d.setTime(segStart + 1000);
  return d.toISOString();
};
