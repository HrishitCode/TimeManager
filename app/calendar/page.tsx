"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import CalendarDayPanel from "@/components/CalendarDayPanel";
import { apiFetch } from "@/lib/api/client";
import { Project, Task } from "@/types/domain";

const toLocalDateInput = (date: Date) => {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
};

const shiftDate = (dateValue: string, deltaDays: number) => {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toLocalDateInput(date);
};

const clampDate = (value: string, min: string, max: string) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

function CalendarPageContent({ token }: { token: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const today = toLocalDateInput(new Date());
  const maxDate = (() => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    return toLocalDateInput(nextYear);
  })();
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    clampDate(searchParams.get("date") ?? today, today, maxDate)
  );

  const load = useCallback(async () => {
    try {
      const [projectsData, tasksData] = await Promise.all([
        apiFetch<Project[]>("/api/projects", token),
        apiFetch<Task[]>("/api/tasks", token)
      ]);
      setProjects(projectsData);
      setTasks(tasksData);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects/tasks");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const fromUrl = clampDate(searchParams.get("date") ?? today, today, maxDate);
    setSelectedDate(fromUrl);
  }, [searchParams, today, maxDate]);

  useEffect(() => {
    if (searchParams.get("date") !== selectedDate) {
      router.replace(`${pathname}?date=${selectedDate}`);
    }
  }, [pathname, router, searchParams, selectedDate]);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${selectedDate}T00:00:00`));

  return (
    <main>
      {error ? <p style={{ color: "#bf4342" }}>{error}</p> : null}
      <section className="card" style={{ marginBottom: 12 }}>
        <h2>{dateLabel}</h2>
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button
            className="ghost"
            onClick={() => setSelectedDate((current) => clampDate(shiftDate(current, -1), today, maxDate))}
            disabled={selectedDate <= today}
          >
            ←
          </button>
          <button
            className="ghost"
            onClick={() => setSelectedDate((current) => clampDate(shiftDate(current, 1), today, maxDate))}
            disabled={selectedDate >= maxDate}
          >
            →
          </button>
          <input
            type="date"
            min={today}
            max={maxDate}
            value={selectedDate}
            onChange={(event) =>
              setSelectedDate(clampDate(event.target.value || today, today, maxDate))
            }
            style={{ maxWidth: 190 }}
          />
        </div>
      </section>
      <CalendarDayPanel
        token={token}
        projects={projects}
        tasks={tasks}
        selectedDate={selectedDate}
        onRefreshProjectsTasks={load}
      />
    </main>
  );
}

export default function CalendarPage() {
  return <AuthGate>{({ token }) => <CalendarPageContent token={token} />}</AuthGate>;
}
