import { describe, expect, it } from "vitest";
import { computeHeadline, computeJointSessions, computeMemberReport, computeVerdicts, MemberInput } from "@/lib/shared/report";
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
    // Default day window 07:00–23:00 = 16h countable.
    expect(r.countable_min).toBe(960);
    expect(r.focus_share_pct).toBeCloseTo(8.3, 1);
    expect(r.planned_share_pct).toBe(12.5);
    // 45×0.417 (fulfilled) + 20×min(1, 120/480) (planned) + 15×0 (on time) + 20×0.5 (tasks) = 33.8
    expect(r.discipline_score).toBe(34);
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

describe("opting time out of reports", () => {
  it("removes an excluded block's whole window, including focus tracked inside it", () => {
    const r = computeMemberReport(
      person("a", "Asha", {
        blocks: [
          { id: "office", title: "Office", starts_at: ist(D, "09:00"), ends_at: ist(D, "18:00"), participant_ids: ["a"], include: false },
          { id: "dsa", title: "DSA", starts_at: ist(D, "19:00"), ends_at: ist(D, "20:00"), participant_ids: ["a"] }
        ],
        entries: [
          { project_id: "work", mode: "focus", started_at: ist(D, "09:00"), ended_at: ist(D, "17:00") }, // office work: ignored
          { project_id: null, mode: "focus", started_at: ist(D, "17:30"), ended_at: ist(D, "18:30") }, // half inside office
          { project_id: null, mode: "focus", started_at: ist(D, "19:00"), ended_at: ist(D, "20:00") }
        ]
      }),
      [D],
      endOfDay
    );
    expect(r.planned_min).toBe(60);
    expect(r.excluded_min).toBe(540);
    expect(r.countable_min).toBe(420); // 16h day window − 9h office
    expect(r.focus_min).toBe(90); // 18:00–18:30 + 19:00–20:00
    expect(r.on_plan_min).toBe(60);
    expect(r.adherence_pct).toBe(100);
    expect(r.blocks.map((b) => b.title)).toEqual(["DSA"]);
    expect(r.best_hour).toBe(19);
    expect(r.projects.find((p) => p.project_id === "work")).toBeUndefined();
  });

  it("ignores excluded entries", () => {
    const r = computeMemberReport(
      person("a", "Asha", {
        entries: [
          { project_id: null, mode: "focus", started_at: ist(D, "10:00"), ended_at: ist(D, "11:00"), include: false },
          { project_id: null, mode: "focus", started_at: ist(D, "12:00"), ended_at: ist(D, "12:30") }
        ]
      }),
      [D],
      endOfDay
    );
    expect(r.focus_min).toBe(30);
    expect(r.excluded_min).toBe(0);
  });
});

describe("countable time & discipline", () => {
  it("widens countable time for work outside the day window, and respects a custom window", () => {
    const late = computeMemberReport(
      person("a", "Asha", { entries: [{ project_id: null, mode: "focus", started_at: ist("2026-11-16", "23:30"), ended_at: ist("2026-11-16", "23:59") }] }),
      [D],
      endOfDay
    );
    expect(late.countable_min).toBe(960 + 29);
    const owl = computeMemberReport(
      { ...person("a", "Asha"), user: { id: "a", name: "Asha", timezone: "Asia/Kolkata", day_start_min: 10 * 60, day_end_min: 26 * 60 } },
      [D],
      new Date(ist("2026-11-17", "03:00")).getTime()
    );
    expect(owl.countable_min).toBe(14 * 60); // 10:00 → midnight (the report day ends at midnight)
  });

  it("gives no discipline score before there is any countable time, and rewards planning enough", () => {
    expect(computeMemberReport(person("a", "Asha"), [D], new Date(ist(D, "06:00")).getTime()).discipline_score).toBeNull();
    const noPlan = computeMemberReport(
      person("a", "Asha", { entries: [{ project_id: null, mode: "focus", started_at: ist(D, "09:00"), ended_at: ist(D, "17:00") }] }),
      [D],
      endOfDay
    );
    expect(noPlan.focus_min).toBe(480);
    expect(noPlan.discipline_score).toBe(0); // lots of work, but nothing planned to keep
    const planner = computeMemberReport(
      person("b", "Ben", {
        blocks: [{ id: "x", title: "Deep work", starts_at: ist(D, "09:00"), ends_at: ist(D, "17:00"), participant_ids: ["b"] }],
        entries: [{ project_id: null, mode: "focus", started_at: ist(D, "09:00"), ended_at: ist(D, "13:00") }]
      }),
      [D],
      endOfDay
    );
    // 45×0.5 + 20×1 (8h ≥ 50% of 16h) + 15×1 = 57.5 of 80 → 72
    expect(planner.discipline_score).toBe(72);
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
    const fulfilled = verdicts.find((v) => v.metric === "Plan fulfilled");
    expect(fulfilled?.winner_id).toBe("a");
    expect(fulfilled?.section).toBe("discipline");
    expect(fulfilled?.text).toContain("Asha kept more of their plan");
  });

  it("separates who worked more from who was more disciplined", () => {
    const asha = computeMemberReport(
      person("a", "Asha", {
        blocks: [{ id: "p", title: "Plan", starts_at: ist(D, "09:00"), ends_at: ist(D, "11:00"), participant_ids: ["a"] }],
        entries: [{ project_id: null, mode: "focus", started_at: ist(D, "09:00"), ended_at: ist(D, "11:00") }]
      }),
      [D],
      endOfDay
    );
    const ben = computeMemberReport(
      person("b", "Ben", { entries: [{ project_id: null, mode: "focus", started_at: ist(D, "09:00"), ended_at: ist(D, "15:00") }] }),
      [D],
      endOfDay
    );
    const verdicts = computeVerdicts([asha, ben]);
    expect(verdicts[0]).toMatchObject({ section: "time", winner_id: null });
    expect(verdicts.find((v) => v.metric === "Focused time")?.winner_id).toBe("b");
    expect(verdicts.find((v) => v.metric === "Discipline")?.winner_id).toBe("a");
    expect(computeHeadline([asha, ben], verdicts)).toBe("Ben worked more (6h vs 2h), but Asha was more disciplined (81 vs 0)."); // 45 + 20×(2h ÷ 8h) + 15 = 65 of 80
  });

  it("flags unequal countable time instead of crowning a winner", () => {
    const office = { id: "o", title: "Office", starts_at: ist(D, "09:00"), ends_at: ist(D, "18:00"), participant_ids: ["a"], include: false };
    const a = computeMemberReport(person("a", "Asha", { blocks: [office] }), [D], endOfDay);
    const b = computeMemberReport(person("b", "Ben"), [D], endOfDay);
    const [time] = computeVerdicts([a, b]);
    expect(time.text).toBe("Not the same amount of time to work with: Asha 7h (9h left out) vs Ben 16h. Compare shares, not just hours.");
  });
});
