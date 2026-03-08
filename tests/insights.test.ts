import { describe, expect, it } from "vitest";
import { buildHourBuckets, buildTaskBreakdown, getMostProductiveHour } from "@/lib/insights";
import { Session, Task } from "@/types/domain";

const sessions: Session[] = [
  {
    id: "1",
    user_id: "u",
    task_id: null,
    project_id: "p",
    mode: "focus",
    status: "completed",
    started_at: "2026-02-21T09:00:00.000Z",
    paused_at: null,
    ended_at: "2026-02-21T09:25:00.000Z",
    planned_duration_sec: 1500,
    actual_duration_sec: 1400,
    overtime_sec: 0,
    accepted_overtime: false
  },
  {
    id: "2",
    user_id: "u",
    task_id: null,
    project_id: "p",
    mode: "focus",
    status: "completed",
    started_at: "2026-02-21T10:00:00.000Z",
    paused_at: null,
    ended_at: "2026-02-21T10:25:00.000Z",
    planned_duration_sec: 1500,
    actual_duration_sec: 1500,
    overtime_sec: 0,
    accepted_overtime: false
  }
];

const tasks: Task[] = [
  {
    id: "a",
    user_id: "u",
    project_id: "p",
    title: "Done",
    description: null,
    kind: "future",
    scheduled_for: null,
    priority: null,
    status: "done",
    recurrence_date: null,
    completed_at: null,
    created_at: "2026-02-21T10:00:00.000Z"
  },
  {
    id: "b",
    user_id: "u",
    project_id: "p",
    title: "Todo",
    description: null,
    kind: "future",
    scheduled_for: null,
    priority: null,
    status: "todo",
    recurrence_date: null,
    completed_at: null,
    created_at: "2026-02-21T10:00:00.000Z"
  }
];

describe("insights helpers", () => {
  it("returns most productive hour", () => {
    const buckets = buildHourBuckets(sessions);
    const expectedHour = new Date(sessions[1].started_at).getHours();
    expect(getMostProductiveHour(buckets).hour).toBe(expectedHour);
  });

  it("builds task breakdown", () => {
    const breakdown = buildTaskBreakdown(tasks);
    expect(breakdown.completionRate).toBe(50);
    expect(breakdown.carryOver).toBe(1);
  });
});
