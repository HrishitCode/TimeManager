import { describe, expect, it } from "vitest";
import { computeDailyReport, dayWindowForIstDate } from "@/lib/reporting";
import { Session, TimeBooking } from "@/types/domain";

const projects = [{ id: "p1", name: "Office Stuff" }];
const tasks = [{ id: "t1", title: "Release Notes" }];

const buildSession = (input: Partial<Session> & Pick<Session, "id" | "started_at" | "ended_at" | "actual_duration_sec">): Session => ({
  id: input.id,
  user_id: "u1",
  task_id: input.task_id ?? "t1",
  project_id: input.project_id ?? "p1",
  mode: "focus",
  status: "stopped",
  started_at: input.started_at,
  paused_at: null,
  ended_at: input.ended_at,
  planned_duration_sec: input.planned_duration_sec ?? input.actual_duration_sec,
  actual_duration_sec: input.actual_duration_sec,
  overtime_sec: 0,
  accepted_overtime: false
});

const booking = (id: string, starts_at: string, ends_at: string, task_id: string | null = "t1"): TimeBooking => ({
  id,
  user_id: "u1",
  project_id: "p1",
  task_id,
  starts_at,
  ends_at,
  created_at: starts_at
});

describe("reporting daily utilization", () => {
  it("handles partial overlap and computes wasted correctly", () => {
    const bookings = [booking("b1", "2026-03-09T04:30:00.000Z", "2026-03-09T05:30:00.000Z")];
    const sessions = [buildSession({ id: "s1", started_at: "2026-03-09T05:00:00.000Z", ended_at: "2026-03-09T05:20:00.000Z", actual_duration_sec: 20 * 60 })];

    const report = computeDailyReport({
      date: "2026-03-09",
      bookings,
      sessions,
      projects,
      tasks
    });

    expect(report.summary.booked_minutes).toBeCloseTo(60, 1);
    expect(report.summary.performed_minutes).toBeCloseTo(20, 1);
    expect(report.summary.wasted_minutes).toBeCloseTo(40, 1);
    expect(report.summary.utilization_pct).toBeCloseTo(33.33, 1);
  });

  it("does not double count multi-session overlap and supports no-task grouping", () => {
    const bookings = [booking("b1", "2026-03-09T04:30:00.000Z", "2026-03-09T06:30:00.000Z", null)];
    const sessions = [
      buildSession({ id: "s1", started_at: "2026-03-09T04:45:00.000Z", ended_at: "2026-03-09T05:45:00.000Z", actual_duration_sec: 60 * 60 }),
      buildSession({ id: "s2", started_at: "2026-03-09T05:15:00.000Z", ended_at: "2026-03-09T06:15:00.000Z", actual_duration_sec: 60 * 60 })
    ];

    const report = computeDailyReport({
      date: "2026-03-09",
      bookings,
      sessions,
      projects,
      tasks
    });

    expect(report.summary.booked_minutes).toBeCloseTo(120, 1);
    expect(report.summary.performed_minutes).toBeCloseTo(90, 1);
    expect(report.task_breakdown[0].name).toBe("No task");
  });

  it("builds hour buckets inside IST day boundaries", () => {
    const day = dayWindowForIstDate("2026-03-09");
    const bookings = [booking("b1", day.start.toISOString(), new Date(day.start.getTime() + 30 * 60 * 1000).toISOString())];
    const sessions = [
      buildSession({
        id: "s1",
        started_at: new Date(day.start.getTime() + 10 * 60 * 1000).toISOString(),
        ended_at: new Date(day.start.getTime() + 20 * 60 * 1000).toISOString(),
        actual_duration_sec: 10 * 60
      })
    ];

    const report = computeDailyReport({
      date: "2026-03-09",
      bookings,
      sessions,
      projects,
      tasks
    });

    const bookedByHour = report.hour_breakdown.reduce((sum, row) => sum + row.booked_minutes, 0);
    const performedByHour = report.hour_breakdown.reduce((sum, row) => sum + row.performed_minutes, 0);
    expect(bookedByHour).toBeCloseTo(report.summary.booked_minutes, 1);
    expect(performedByHour).toBeCloseTo(report.summary.performed_minutes, 1);
  });
});
