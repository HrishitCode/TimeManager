"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api/client";
import ProjectTaskSelection from "@/components/ProjectTaskSelection";
import { Project, Task, TimeBooking } from "@/types/domain";

const parseDurationMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return Math.max(0, hours * 60 + minutes);
};

const formatDateTime24 = (value: string) =>
  new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

interface Props {
  token: string;
  projects: Project[];
  tasks: Task[];
  selectedDate: string;
  onRefreshProjectsTasks: () => Promise<void>;
}

export default function CalendarDayPanel({
  token,
  projects,
  tasks,
  selectedDate,
  onRefreshProjectsTasks
}: Props) {
  const [bookings, setBookings] = useState<TimeBooking[]>([]);
  const [activeBookingHour, setActiveBookingHour] = useState<number | null>(null);
  const [projectId, setProjectId] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState("#2364aa");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [durationValue, setDurationValue] = useState("01:00");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(new Date());
  const [overlapBooking, setOverlapBooking] = useState<TimeBooking | null>(null);

  const loadBookings = useCallback(async () => {
    try {
      const data = await apiFetch<TimeBooking[]>(`/api/calendar/day?date=${selectedDate}`, token);
      setBookings(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    }
  }, [selectedDate, token]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    if (isCreatingProject) {
      return;
    }
    if (!projectId && projects[0]) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId, isCreatingProject]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setActiveBookingHour(null);
  }, [selectedDate]);

  const projectTasks = useMemo(
    () => tasks.filter((task) => task.project_id === projectId),
    [tasks, projectId]
  );

  useEffect(() => {
    if (!projectId) {
      setTaskId("");
      setIsCreatingTask(false);
      return;
    }
    const firstTask = tasks.find((task) => task.project_id === projectId);
    setTaskId((current) => current || firstTask?.id || "");
    setIsCreatingTask(false);
  }, [projectId, tasks]);

  useEffect(() => {
    if (taskId && !projectTasks.find((task) => task.id === taskId)) {
      setTaskId("");
    }
  }, [projectTasks, taskId]);

  const todayDate = useMemo(() => {
    const date = now;
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60_000);
    return local.toISOString().slice(0, 10);
  }, [now]);

  const isPastDate = selectedDate < todayDate;
  const isToday = selectedDate === todayDate;
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const isPastHour = (hour: number) => {
    if (isPastDate) return true;
    if (!isToday) return false;
    return hour < currentHour;
  };

  const isCurrentHour = (hour: number) => isToday && hour === currentHour;

  const canBookHour = (hour: number) => {
    if (isPastDate) return false;
    if (!isToday) return true;
    return hour > currentHour;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveBookingHour(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setOverlapBooking(null);
  }, [activeBookingHour, selectedDate, projectId, taskId, durationValue]);

  const isHourBooked = (hour: number): boolean => {
    const start = new Date(`${selectedDate}T${hour.toString().padStart(2, "0")}:00:00`);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return bookings.some((booking) => {
      const bookingStart = new Date(booking.starts_at);
      const bookingEnd = new Date(booking.ends_at);
      return bookingStart < end && bookingEnd > start;
    });
  };

  const bookingsForHour = (hour: number) => {
    const start = new Date(`${selectedDate}T${hour.toString().padStart(2, "0")}:00:00`);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return bookings.filter((booking) => {
      const bookingStart = new Date(booking.starts_at);
      const bookingEnd = new Date(booking.ends_at);
      return bookingStart < end && bookingEnd > start;
    });
  };

  const submitBooking = async () => {
    if (activeBookingHour === null) return;
    if (!projectId) {
      setError("Select a project");
      return;
    }
    if (!canBookHour(activeBookingHour)) {
      setError("You can only book from upcoming hours.");
      return;
    }

    const start = new Date(`${selectedDate}T${activeBookingHour.toString().padStart(2, "0")}:00:00`);
    const durationMinutes = parseDurationMinutes(durationValue);
    if (durationMinutes <= 0) {
      setError("Enter a valid duration (HH:MM).");
      return;
    }
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + durationMinutes);

    try {
      setNotice("");
      setOverlapBooking(null);
      const bookingTaskId = await ensureTaskForBooking();
      if (isCreatingTask && !bookingTaskId) {
        return;
      }
      await apiFetch<TimeBooking>("/api/calendar/day", token, {
        method: "POST",
        body: JSON.stringify({
          projectId,
          taskId: bookingTaskId,
          startIso: start.toISOString(),
          endIso: end.toISOString()
        })
      });
      setError("");
      setNotice(
        `Booked ${activeBookingHour.toString().padStart(2, "0")}:00 for ${durationValue}.`
      );
      setActiveBookingHour(null);
      await loadBookings();
    } catch (err) {
      if (err instanceof ApiError && err.payload && typeof err.payload === "object" && "overlap" in err.payload) {
        const overlap = (err.payload as { overlap?: TimeBooking }).overlap;
        setOverlapBooking(overlap ?? null);
      }
      setError(err instanceof Error ? err.message : "Failed to create booking");
    }
  };

  const removeBooking = async (bookingId: string) => {
    try {
      await apiFetch<{ success: boolean }>(`/api/calendar/day/${bookingId}`, token, {
        method: "DELETE"
      });
      setError("");
      setNotice("Booking removed.");
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove booking");
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      setError("");
      const created = await apiFetch<Project>("/api/projects", token, {
        method: "POST",
        body: JSON.stringify({ name: newProjectName.trim(), color: newProjectColor })
      });
      setNewProjectName("");
      await onRefreshProjectsTasks();
      setIsCreatingProject(false);
      setProjectId(created.id);
      setTaskId("");
      setIsCreatingTask(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    }
  };

  const createTask = async () => {
    if (!projectId || !newTaskTitle.trim()) return;
    try {
      setError("");
      const created = await apiFetch<Task>("/api/tasks", token, {
        method: "POST",
        body: JSON.stringify({
          projectId,
          title: newTaskTitle.trim(),
          kind: "future",
          scheduledFor: null
        })
      });
      setNewTaskTitle("");
      await onRefreshProjectsTasks();
      setTaskId(created.id);
      setIsCreatingTask(false);
      setNotice("Task created successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create task");
    }
  };

  const ensureTaskForBooking = async (): Promise<string | null> => {
    if (!isCreatingTask) {
      return taskId || null;
    }
    if (!projectId || !newTaskTitle.trim()) {
      setError("Enter a task title to create and book it.");
      return null;
    }

    const created = await apiFetch<Task>("/api/tasks", token, {
        method: "POST",
        body: JSON.stringify({
          projectId,
          title: newTaskTitle.trim(),
          kind: "future",
          scheduledFor: null
        })
      });

      setNewTaskTitle("");
      await onRefreshProjectsTasks();
    setTaskId(created.id);
    setIsCreatingTask(false);
    return created.id;
  };

  return (
    <section className="card">
      <h2>Today&apos;s Schedule</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Click an empty hour to book time.
      </p>

      {error ? <p style={{ marginTop: 8, color: "#bf4342" }}>{error}</p> : null}
      {notice ? <p style={{ marginTop: 8, color: "#2364aa" }}>{notice}</p> : null}
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

      <div className="calendar-grid">
        {Array.from({ length: 24 }, (_, hour) => {
          const occupied = isHourBooked(hour);
          const hourBookings = bookingsForHour(hour);
          const pastHour = isPastHour(hour);
          const currentHourSlot = isCurrentHour(hour);
          const bookableHour = canBookHour(hour);

          return (
            <div
              key={hour}
              className={`calendar-slot ${pastHour ? "past" : occupied ? "booked" : "free"}`}
            >
              <strong className="calendar-time">{hour.toString().padStart(2, "0")}:00</strong>
              {occupied ? (
                <div className="calendar-track">
                  {hourBookings.map((booking) => {
                    const hourStart = new Date(
                      `${selectedDate}T${hour.toString().padStart(2, "0")}:00:00`
                    );
                    const hourEnd = new Date(hourStart);
                    hourEnd.setHours(hourEnd.getHours() + 1);
                    const bookingStart = new Date(booking.starts_at);
                    const bookingEnd = new Date(booking.ends_at);
                    const overlapStartMs = Math.max(hourStart.getTime(), bookingStart.getTime());
                    const overlapEndMs = Math.min(hourEnd.getTime(), bookingEnd.getTime());
                    const overlapMs = overlapEndMs - overlapStartMs;
                    if (overlapMs <= 0) return null;

                    const startPct = ((overlapStartMs - hourStart.getTime()) / 3_600_000) * 100;
                    const widthPct = Math.max(5, (overlapMs / 3_600_000) * 100);
                    const project = projects.find((project) => project.id === booking.project_id);
                    const task = tasks.find((task) => task.id === booking.task_id);
                    return (
                      <div
                        key={booking.id}
                        className="booking-pill"
                        style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                        title={`${project?.name ?? "Project"}${task ? ` · ${task.title}` : ""}`}
                      >
                        <span className="booking-pill-text">
                          {project?.name ?? "Project"}
                          {task ? ` · ${task.title}` : ""}
                        </span>
                        <button
                          type="button"
                          className="booking-pill-remove"
                          onClick={() => void removeBooking(booking.id)}
                          aria-label="Remove booking"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                  {currentHourSlot ? (
                    <div
                      className="calendar-now-line"
                      style={{ left: `${(currentMinute / 60) * 100}%` }}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              ) : (
                <button
                  className="ghost"
                  onClick={() => {
                    setActiveBookingHour(hour);
                    setNotice("");
                    setError("");
                  }}
                  disabled={!bookableHour}
                >
                  {bookableHour ? "Book this slot" : "Time passed"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {activeBookingHour !== null ? (
        <div
          onClick={() => setActiveBookingHour(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.58)",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Book time slot"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 760,
              background: "var(--card)",
              border: "1px solid var(--field-border)",
              borderRadius: 14,
              padding: "1rem",
              boxShadow: "0 20px 45px rgba(2, 6, 23, 0.25)",
              display: "grid",
              gap: 10
            }}
          >
            <strong>Book {activeBookingHour.toString().padStart(2, "0")}:00</strong>
            <ProjectTaskSelection
              projects={projects}
              tasks={tasks}
              selectedProjectId={projectId}
              selectedTaskId={taskId}
              isCreatingProject={isCreatingProject}
              isCreatingTask={isCreatingTask}
              newProjectName={newProjectName}
              newProjectColor={newProjectColor}
              newTaskTitle={newTaskTitle}
              taskOptionalLabel="No task (optional)"
              onSelectProject={setProjectId}
              onSelectTask={setTaskId}
              onSetIsCreatingProject={setIsCreatingProject}
              onSetIsCreatingTask={setIsCreatingTask}
              onSetNewProjectName={setNewProjectName}
              onSetNewProjectColor={setNewProjectColor}
              onSetNewTaskTitle={setNewTaskTitle}
              onCreateProject={createProject}
              onCreateTask={createTask}
            />
            <div>
              <label>Duration (HH:MM)</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{2}:[0-9]{2}"
                placeholder="01:00"
                value={durationValue}
                onChange={(event) => setDurationValue(event.target.value)}
              />
            </div>
            <div className="row">
              <button className="primary" onClick={() => void submitBooking()}>
                Confirm Booking
              </button>
              <button className="ghost" onClick={() => setActiveBookingHour(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
