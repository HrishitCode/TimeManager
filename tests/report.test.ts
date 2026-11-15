import { describe, expect, it } from "vitest";
import { computeJointSessions, computeMemberReport, computeVerdicts, MemberInput } from "@/lib/shared/report";
import { ist } from "./helpers";

const D = "2026-11-16";
const endOfDay = new Date(ist("2026-11-17", "00:00")).getTime();

const person = (id: string, name: string, over: Partial<MemberInput> = {}): MemberInput => ({
  user: { id, name, timezone: "Asia/Kolkata" },
  blocks: [],
  entries: [],
  tasks_done: 0,
  tasks_due: 0,
  projects: [],
  ...over
});

describe("computeMemberReport", () => {
  it("measures adherence, lateness and off-plan time", () => {
    const r = computeMemberReport(
      person("a", "Asha", {
        blocks: [
          { id: "b1", title: "DSA", starts_at: ist(D, "09:00"), ends_at: ist(D, "10:00"), participant_ids: ["a"] },
          { id: "b2", title: "System design", starts_at: ist(D, "14:00"), ends_at: ist(D, "15:00"), participant_ids: ["a"] }
        ],
        entries: [
          { project_id: null, mode: "focus", started_at: ist(D, "09:10"), ended_at: ist(D, "10:00") }, // 50m on plan, 10m late
          { project_id: null, mode: "focus", started_at: ist(D, "11:00"), ended_at: ist(D, "11:30") }, // 30m off plan
          { project_id: null, mode: "break", started_at: ist(D, "10:00"), ended_at: ist(D, "10:15") } // ignored
        ],
        tasks_done: 1,
        tasks_due: 2
      }),
      [D],
      endOfDay
    );
    expect(r.planned_min).toBe(120);
    expect(r.focus_min).toBe(80);
    expect(r.on_plan_min).toBe(50);
    expect(r.off_plan_min).toBe(30);
    expect(r.adherence_pct).toBeCloseTo(41.7, 1);
    expect(r.blocks_started).toBe(1);
    expect(r.blocks_skipped).toBe(1);
    expect(r.avg_late_min).toBe(10);
    expect(r.on_time_pct).toBe(0);
    expect(r.avg_start_min).toBe(9 * 60 + 10);
    expect(r.best_hour).toBe(9);
    // 0.5*41.7 + 0.2*0 + 30*0.5
    expect(r.score).toBe(36);
  });

  it("doesn't penalise blocks that haven't happened yet", () => {
    const r = computeMemberReport(
      person("a", "Asha", {
        blocks: [
          { id: "b1", title: "Morning", starts_at: ist(D, "09:00"), ends_at: ist(D, "10:00"), participant_ids: ["a"] },
          { id: "b2", title: "Evening", starts_at: ist(D, "18:00"), ends_at: ist(D, "19:00"), participant_ids: ["a"] }
        ],
        entries: [{ project_id: null, mode: "focus", started_at: ist(D, "09:00"), ended_at: ist(D, "10:00") }]
      }),
      [D],
      new Date(ist(D, "12:00")).getTime()
    );
    expect(r.planned_min).toBe(60);
    expect(r.upcoming_min).toBe(60);
    expect(r.adherence_pct).toBe(100);
    expect(r.blocks_planned).toBe(1);
  });
});

describe("comparison", () => {
  it("reports joint session attendance and crowns winners", () => {
    const shared = { id: "j1", title: "Study together", starts_at: ist(D, "20:00"), ends_at: ist(D, "21:00"), participant_ids: ["a", "b"] };
    const a = computeMemberReport(
      person("a", "Asha", { blocks: [shared], entries: [{ project_id: null, mode: "focus", started_at: ist(D, "20:00"), ended_at: ist(D, "21:00") }] }),
      [D],
      endOfDay
    );
    const b = computeMemberReport(
      person("b", "Ben", { blocks: [shared], entries: [{ project_id: null, mode: "focus", started_at: ist(D, "20:30"), ended_at: ist(D, "21:00") }] }),
      [D],
      endOfDay
    );
    const joint = computeJointSessions([shared], [a, b]);
    expect(joint).toHaveLength(1);
    expect(joint[0].members.map((m) => [m.name, m.attended_min, m.late_min])).toEqual([
      ["Asha", 60, 0],
      ["Ben", 30, 30]
    ]);
    const verdicts = computeVerdicts([a, b]);
    const adherence = verdicts.find((v) => v.metric === "Plan adherence");
    expect(adherence?.winner_id).toBe("a");
    expect(adherence?.text).toContain("Asha stuck to the plan better");
  });
});
