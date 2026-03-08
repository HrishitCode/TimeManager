"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { SessionMode, TimerStateResponse } from "@/types/domain";

interface Props {
  token: string;
  projectName: string;
  taskName?: string;
  selectedProjectId: string;
  selectedTaskId: string;
  bookedDurationMinutes?: number | null;
  onRefresh: () => Promise<void>;
}

interface TimerMutationResponse {
  timerState: TimerStateResponse["timerState"];
  activeSession: TimerStateResponse["activeSession"];
}

export default function TimerPanel({
  token,
  projectName,
  taskName,
  selectedProjectId,
  selectedTaskId,
  bookedDurationMinutes,
  onRefresh
}: Props) {
  const [state, setState] = useState<TimerStateResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [showOvertimeDecision, setShowOvertimeDecision] = useState<boolean>(false);
  const [mode, setMode] = useState<SessionMode>("focus");
  const [minutes, setMinutes] = useState<number>(25);
  const [now, setNow] = useState<number>(Date.now());

  const title = useMemo(() => {
    if (projectName && taskName) {
      return `${projectName} + ${taskName}`;
    }
    if (projectName) {
      return projectName;
    }
    return "Timer";
  }, [projectName, taskName]);

  const loadState = useCallback(async () => {
    try {
      const next = await apiFetch<TimerStateResponse>("/api/timer/state", token);
      setState(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timer state");
    }
  }, [token]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      void loadState();
    }, 5000);
    return () => window.clearInterval(handle);
  }, [loadState]);

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (bookedDurationMinutes && bookedDurationMinutes > 0) {
      setMinutes(bookedDurationMinutes);
      return;
    }
    setMinutes(25);
  }, [bookedDurationMinutes]);

  const elapsedSec = useMemo(() => {
    if (!state?.activeSession) {
      return 0;
    }
    const base = state.activeSession.actual_duration_sec;
    if (state.activeSession.status !== "running") {
      return base;
    }
    const currentSegment = Math.max(
      0,
      Math.floor((now - new Date(state.activeSession.started_at).getTime()) / 1000)
    );
    return base + currentSegment;
  }, [state, now]);

  const remainingRaw = useMemo(() => {
    if (!state?.activeSession) {
      return 0;
    }
    return state.activeSession.planned_duration_sec - elapsedSec;
  }, [state, elapsedSec]);

  const remaining = Math.max(0, remainingRaw);
  const overtimeSec = Math.max(0, -remainingRaw);

  const prettyTime = useMemo(() => {
    const m = Math.floor(remaining / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(remaining % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  }, [remaining]);

  const overtimePretty = useMemo(() => {
    const m = Math.floor(overtimeSec / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(overtimeSec % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  }, [overtimeSec]);

  const mutate = async (path: string, body?: object) => {
    try {
      const response = await apiFetch<TimerMutationResponse>(path, token, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined
      });
      setState({ activeSession: response.activeSession, timerState: response.timerState });
      if (path === "/api/timer/start") {
        setShowOvertimeDecision(false);
      }
      setError("");
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Timer action failed");
    }
  };

  const stopWithOvertimeDecision = async (acceptOvertime: boolean) => {
    if (!state?.activeSession) {
      return;
    }
    setShowOvertimeDecision(false);
    await mutate("/api/timer/stop", {
      stateVersion: state.timerState.state_version,
      deviceId: crypto.randomUUID(),
      acceptOvertime
    });
  };

  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Manual start/pause/stop across devices.
      </p>
      {error ? (
        <p style={{ marginTop: 8, color: "#bf4342" }}>
          {error}
        </p>
      ) : null}

      <div style={{ fontSize: 56, fontWeight: 700, marginTop: 16 }}>{prettyTime}</div>
      {overtimeSec > 0 ? (
        <p style={{ marginTop: 6, color: "#bf4342", fontWeight: 600 }}>
          Overtime: +{overtimePretty}
        </p>
      ) : null}
      <p className="muted" style={{ marginTop: 8 }}>
        Project: <strong>{projectName || "Select a project"}</strong>
      </p>
      {taskName ? (
        <p className="muted">
          Task: <strong>{taskName}</strong>
        </p>
      ) : null}
      <p className="muted">
        {state?.activeSession
          ? `Mode: ${state.activeSession.mode.replace("_", " ")} (${state.activeSession.status})`
          : "No active session"}
      </p>

      <div className="row wrap" style={{ marginTop: 10 }}>
        <div style={{ minWidth: 140, flex: 1 }}>
          <label>Mode</label>
          <select value={mode} onChange={(event) => setMode(event.target.value as SessionMode)}>
            <option value="focus">Focus</option>
            <option value="short_break">Short break</option>
            <option value="long_break">Long break</option>
          </select>
        </div>
        <div style={{ minWidth: 120, flex: 1 }}>
          <label>Minutes</label>
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 12 }}>
        <button
          className="primary"
          onClick={() =>
            mutate("/api/timer/start", {
              projectId: selectedProjectId,
              taskId: selectedTaskId || null,
              mode,
              plannedDurationSec: minutes * 60,
              stateVersion: state?.timerState.state_version ?? 0,
              deviceId: crypto.randomUUID()
            })
          }
          disabled={!selectedProjectId}
        >
          Start
        </button>
        <button
          className="ghost"
          onClick={() =>
            mutate("/api/timer/pause", {
              stateVersion: state?.timerState.state_version,
              deviceId: crypto.randomUUID()
            })
          }
          disabled={!state?.activeSession}
        >
          Pause
        </button>
        <button
          className="ghost"
          onClick={() =>
            mutate("/api/timer/resume", {
              stateVersion: state?.timerState.state_version,
              deviceId: crypto.randomUUID()
            })
          }
          disabled={!state?.activeSession}
        >
          Resume
        </button>
        <button
          className="danger"
          onClick={() => {
            if (!state?.activeSession) return;
            if (overtimeSec > 0) {
              setShowOvertimeDecision(true);
              return;
            }
            void stopWithOvertimeDecision(false);
          }}
          disabled={!state?.activeSession}
        >
          Stop
        </button>
      </div>
      {showOvertimeDecision ? (
        <div className="overtime-decision">
          <p className="overtime-decision-text">
            You are {overtimePretty} over. Add this to overtime for this task/project?
          </p>
          <div className="row">
            <button className="primary" onClick={() => void stopWithOvertimeDecision(true)}>
              Accept Extra Time
            </button>
            <button className="ghost" onClick={() => void stopWithOvertimeDecision(false)}>
              Ignore Extra Time
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
