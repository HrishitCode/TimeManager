"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import ProjectTaskSelection from "@/components/ProjectTaskSelection";
import TimerPanel from "@/components/TimerPanel";
import { ApiError, apiFetch } from "@/lib/api/client";
import { Project, Task, TimeBooking, TimerStateResponse } from "@/types/domain";

const nowLocalDateTimeInput = () => {
  const nowDate = new Date();
  nowDate.setSeconds(0, 0);
  const offset = nowDate.getTimezoneOffset();
  const local = new Date(nowDate.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const parseLocalDateTime = (value: string): Date | null => {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
};

const parseDurationMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return Math.max(0, hours * 60 + minutes);
};

const formatTime24 = (value: string | Date) =>
  new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

const formatDateTime24 = (value: string | Date) =>
  new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

function Dashboard({ token }: { token: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState("#2364aa");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectionDateTime, setSelectionDateTime] = useState(nowLocalDateTimeInput());
  const [activeBooking, setActiveBooking] = useState<TimeBooking | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState("");
  const [futureBookingDuration, setFutureBookingDuration] = useState("01:00");
  const [showFutureBookingPrompt, setShowFutureBookingPrompt] = useState(false);
  const [notice, setNotice] = useState("");
  const [overlapBooking, setOverlapBooking] = useState<TimeBooking | null>(null);
  const [timerState, setTimerState] = useState<TimerStateResponse | null>(null);
  const [dismissedStartPromptForBookingId, setDismissedStartPromptForBookingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [projectsData, tasksData] = await Promise.all([
      apiFetch<Project[]>("/api/projects", token),
      apiFetch<Task[]>("/api/tasks", token)
    ]);
    setProjects(projectsData);
    setTasks(tasksData);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadActiveBooking = useCallback(async () => {
    const today = (() => {
      const offset = now.getTimezoneOffset();
      const local = new Date(now.getTime() - offset * 60_000);
      return local.toISOString().slice(0, 10);
    })();
    const bookings = await apiFetch<TimeBooking[]>(`/api/calendar/day?date=${today}`, token);
    const active = bookings.find((booking) => {
      const start = new Date(booking.starts_at).getTime();
      const end = new Date(booking.ends_at).getTime();
      const at = now.getTime();
      return at >= start && at < end;
    });
    setActiveBooking(active ?? null);
  }, [token, now]);

  useEffect(() => {
    void loadActiveBooking();
  }, [loadActiveBooking]);

  const loadTimerState = useCallback(async () => {
    const state = await apiFetch<TimerStateResponse>("/api/timer/state", token);
    setTimerState(state);
  }, [token]);

  useEffect(() => {
    void loadTimerState();
  }, [loadTimerState, activeBooking]);

  useEffect(() => {
    if (activeBooking) {
      setSelectedProjectId(activeBooking.project_id);
      setSelectedTaskId(activeBooking.task_id ?? "");
      setIsCreatingProject(false);
      setIsCreatingTask(false);
      return;
    }
    if (isCreatingProject) {
      return;
    }
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
    if (selectedProjectId && !projects.find((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id ?? "");
    }
  }, [projects, selectedProjectId, isCreatingProject, activeBooking]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedTaskId("");
      setIsCreatingTask(false);
      return;
    }
    const firstTask = tasks.find((task) => task.project_id === selectedProjectId);
    setSelectedTaskId((current) => current || firstTask?.id || "");
    setIsCreatingTask(false);
  }, [selectedProjectId, tasks]);

  useEffect(() => {
    const projectTasks = tasks.filter((task) => task.project_id === selectedProjectId);
    if (selectedTaskId && !projectTasks.find((task) => task.id === selectedTaskId)) {
      setSelectedTaskId("");
    }
  }, [tasks, selectedProjectId, selectedTaskId]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      setError("");
      setNotice("");
      const created = await apiFetch<Project>("/api/projects", token, {
        method: "POST",
        body: JSON.stringify({ name: newProjectName.trim(), color: newProjectColor })
      });
      setNewProjectName("");
      await load();
      setIsCreatingProject(false);
      setSelectedProjectId(created.id);
      setSelectedTaskId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    }
  };

  const createTask = async () => {
    if (!selectedProjectId || !newTaskTitle.trim()) return;
    try {
      setError("");
      setNotice("");
      const created = await apiFetch<Task>("/api/tasks", token, {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProjectId,
          title: newTaskTitle.trim(),
          kind: "future",
          scheduledFor: null
        })
      });
      setNewTaskTitle("");
      await load();
      setSelectedTaskId(created.id);
      setIsCreatingTask(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create task");
    }
  };

  const activeProject = projects.find((project) => project.id === activeBooking?.project_id);
  const activeTask = tasks.find((task) => task.id === activeBooking?.task_id);
  const activeBookingDurationMinutes = activeBooking
    ? Math.max(
        1,
        Math.round(
          (new Date(activeBooking.ends_at).getTime() - new Date(activeBooking.starts_at).getTime()) /
            60_000
        )
      )
    : null;
  const activeProgressPct = (() => {
    if (!activeBooking) return 0;
    const start = new Date(activeBooking.starts_at).getTime();
    const end = new Date(activeBooking.ends_at).getTime();
    const total = Math.max(1, end - start);
    return Math.max(0, Math.min(100, ((now.getTime() - start) / total) * 100));
  })();

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedDateTime = parseLocalDateTime(selectionDateTime);
  const isSelectionFuture =
    selectedDateTime !== null && selectedDateTime.getTime() > now.getTime();

  useEffect(() => {
    if (isSelectionFuture && !activeBooking) {
      setShowFutureBookingPrompt(true);
      return;
    }
    setShowFutureBookingPrompt(false);
  }, [isSelectionFuture, activeBooking, selectionDateTime]);

  useEffect(() => {
    setOverlapBooking(null);
  }, [selectionDateTime, futureBookingDuration, selectedProjectId, selectedTaskId]);

  useEffect(() => {
    if (!activeBooking) {
      setDismissedStartPromptForBookingId(null);
    }
  }, [activeBooking]);

  const startTimerForActiveBooking = async () => {
    if (!activeBooking) return;
    const latest = await apiFetch<TimerStateResponse>("/api/timer/state", token);
    const start = new Date(activeBooking.starts_at);
    const end = new Date(activeBooking.ends_at);
    const bookingDurationSec = Math.max(60, Math.floor((end.getTime() - start.getTime()) / 1000));
    const lateStartOffsetSec = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000));

    const started = await apiFetch<TimerStateResponse>("/api/timer/start", token, {
      method: "POST",
      body: JSON.stringify({
        projectId: activeBooking.project_id,
        taskId: activeBooking.task_id,
        mode: "focus",
        plannedDurationSec: bookingDurationSec,
        initialElapsedSec: lateStartOffsetSec,
        stateVersion: latest.timerState.state_version,
        deviceId: crypto.randomUUID()
      })
    });
    setTimerState(started);
    if (lateStartOffsetSec > 0) {
      const lateMinutes = Math.floor(lateStartOffsetSec / 60);
      const lateSeconds = lateStartOffsetSec % 60;
      setNotice(
        `Timer started. Late by ${lateMinutes.toString().padStart(2, "0")}:${lateSeconds
          .toString()
          .padStart(2, "0")} and tracked.`
      );
    } else {
      setNotice("Timer started for current booking.");
    }
    setDismissedStartPromptForBookingId(activeBooking.id);
  };

  const bookSelectionTime = async () => {
    if (!selectedProjectId || !selectedDateTime || Number.isNaN(selectedDateTime.getTime())) {
      setError("Select a valid project and future selection time.");
      return;
    }

    const durationMinutes = parseDurationMinutes(futureBookingDuration);
    if (durationMinutes <= 0) {
      setError("Enter a valid duration (HH:MM).");
      return;
    }
    const end = new Date(selectedDateTime);
    end.setMinutes(end.getMinutes() + durationMinutes);

    try {
      setError("");
      setNotice("");
      setOverlapBooking(null);
      await apiFetch<TimeBooking>("/api/calendar/day", token, {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProjectId,
          taskId: selectedTaskId || null,
          startIso: selectedDateTime.toISOString(),
          endIso: end.toISOString()
        })
      });
      setNotice("Time booked from selection.");
      setShowFutureBookingPrompt(false);
    } catch (err) {
      if (err instanceof ApiError && err.payload && typeof err.payload === "object" && "overlap" in err.payload) {
        const overlap = (err.payload as { overlap?: TimeBooking }).overlap;
        setOverlapBooking(overlap ?? null);
      }
      setError(err instanceof Error ? err.message : "Could not book selected time");
    }
  };

  return (
    <main>
      <div style={{ marginBottom: 10 }} className="row wrap">
        <Link href="/calendar">
          <button className="ghost" type="button">
            Calendar
          </button>
        </Link>
        <Link href="/insights">
          <button className="ghost" type="button">
            Insights
          </button>
        </Link>
      </div>

      {activeBooking ? (
        <section className="card active-booking-banner" style={{ marginBottom: 12 }}>
          <div className="wave-layer" />
          <h2>Live Booking</h2>
          <p style={{ marginTop: 6 }}>
            <strong>{activeProject?.name ?? "Project"}</strong>
            {activeTask ? ` · ${activeTask.title}` : ""}
          </p>
          <p className="muted" style={{ marginTop: 4 }}>
            {formatTime24(activeBooking.starts_at)} - {formatTime24(activeBooking.ends_at)}
          </p>
          <div className="booking-progress">
            <div className="booking-progress-fill" style={{ width: `${activeProgressPct}%` }} />
          </div>
        </section>
      ) : (
        <section className="card" style={{ marginBottom: 12 }}>
          <h2>Selection</h2>
          {notice ? <p style={{ color: "#2364aa", marginTop: 8 }}>{notice}</p> : null}
          <ProjectTaskSelection
            projects={projects}
            tasks={tasks}
            selectedProjectId={selectedProjectId}
            selectedTaskId={selectedTaskId}
            isCreatingProject={isCreatingProject}
            isCreatingTask={isCreatingTask}
            newProjectName={newProjectName}
            newProjectColor={newProjectColor}
            newTaskTitle={newTaskTitle}
            showSelectionDateTime
            selectionDateTime={selectionDateTime}
            error={error}
            onSelectProject={setSelectedProjectId}
            onSelectTask={setSelectedTaskId}
            onSetIsCreatingProject={setIsCreatingProject}
            onSetIsCreatingTask={setIsCreatingTask}
            onSetNewProjectName={setNewProjectName}
            onSetNewProjectColor={setNewProjectColor}
            onSetNewTaskTitle={setNewTaskTitle}
            onSetSelectionDateTime={setSelectionDateTime}
            onCreateProject={createProject}
            onCreateTask={createTask}
          />
        </section>
      )}

      {!activeBooking && showFutureBookingPrompt && selectedDateTime ? (
        <section className="card" style={{ marginBottom: 12 }}>
          <h2>Book This Selection Time?</h2>
          <p style={{ marginTop: 6 }}>
            {formatDateTime24(selectedDateTime)} for{" "}
            <strong>{selectedProject?.name ?? "Selected project"}</strong>
            {selectedTask ? ` · ${selectedTask.title}` : ""}
          </p>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <div style={{ minWidth: 180 }}>
              <label>Duration</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{2}:[0-9]{2}"
                placeholder="01:00"
                value={futureBookingDuration}
                onChange={(event) => setFutureBookingDuration(event.target.value)}
              />
            </div>
            <div className="row" style={{ alignItems: "end" }}>
              <button className="primary" type="button" onClick={() => void bookSelectionTime()}>
                Yes, Book It
              </button>
              <button className="ghost" type="button" onClick={() => setShowFutureBookingPrompt(false)}>
                Not now
              </button>
            </div>
          </div>
          {overlapBooking ? (
            <div className="conflict-card" style={{ marginTop: 10 }}>
              <h3 className="conflict-title">Conflicting Booking</h3>
              <p className="conflict-primary">
                <strong>{projects.find((project) => project.id === overlapBooking.project_id)?.name ?? "Project"}</strong>
                {(() => {
                  const task = tasks.find((t) => t.id === overlapBooking.task_id);
                  return task ? ` · ${task.title}` : "";
                })()}
              </p>
              <div className="conflict-meta">
                <div>
                  <span>Start</span>
                  <strong>{formatDateTime24(overlapBooking.starts_at)}</strong>
                </div>
                <div>
                  <span>End</span>
                  <strong>{formatDateTime24(overlapBooking.ends_at)}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeBooking &&
      (!timerState?.activeSession || timerState.activeSession.status !== "running") &&
      dismissedStartPromptForBookingId !== activeBooking.id ? (
        <section className="card" style={{ marginBottom: 12, border: "1px solid var(--accent)" }}>
          <h2>Booked Time Started</h2>
          <p style={{ marginTop: 6 }}>
            Start timer for <strong>{activeProject?.name ?? "Project"}</strong>
            {activeTask ? ` · ${activeTask.title}` : ""}?
          </p>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => void startTimerForActiveBooking()}>
              Start Timer
            </button>
            <button
              className="ghost"
              onClick={() => setDismissedStartPromptForBookingId(activeBooking.id)}
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      <TimerPanel
        token={token}
        projectName={selectedProject?.name ?? ""}
        taskName={selectedTask?.title}
        selectedProjectId={selectedProjectId}
        selectedTaskId={selectedTaskId}
        bookedDurationMinutes={activeBookingDurationMinutes}
        onRefresh={load}
      />
    </main>
  );
}

export default function HomePage() {
  return <AuthGate>{({ token }) => <Dashboard token={token} />}</AuthGate>;
}
