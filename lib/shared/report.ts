// Pure report computation. No I/O: callers load rows, this turns them into numbers.
// Everything is interval math over two sets per person: PLANNED (accepted blocks) and DONE (focus entries).

import type { BlockOutcome, DaySeriesPoint, JointSessionOutcome, MemberReport, ProjectSlice, Verdict } from "./types";
import { clip, dayRange, fmtDuration, hourInTz, intersect, Interval, mergeIntervals, msToMin, toInterval, totalMs, zonedMidnight } from "./time";

export interface ReportBlock {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  /** Accepted participant ids (owner included). */
  participant_ids: string[];
}

export interface ReportEntry {
  project_id: string | null;
  mode: "focus" | "break";
  started_at: string;
  ended_at: string;
}

export interface MemberInput {
  user: { id: string; name: string; timezone: string };
  blocks: ReportBlock[];
  entries: ReportEntry[];
  tasks_done: number;
  tasks_due: number;
  projects: { id: string; name: string; color: string }[];
}

/** A block counts as "on time" if focus started within this many minutes of its start. */
export const ON_TIME_GRACE_MIN = 5;
/** A finished block with less than this share attended counts as skipped. */
export const SKIP_THRESHOLD_PCT = 20;

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? r1(Math.min(100, (num / den) * 100)) : 0);

/**
 * Composite 0–100 "time management" score. Deliberately simple and explainable:
 *   50% plan adherence  — of the time you planned (and that has passed), how much did you actually focus?
 *   20% punctuality     — share of started blocks where focus began within 5 minutes
 *   30% task follow-through — tasks completed vs tasks due in the period
 */
export const scoreOf = (m: Pick<MemberReport, "adherence_pct" | "on_time_pct" | "tasks_done" | "tasks_due">) => {
  const taskRate = m.tasks_due > 0 ? Math.min(1, m.tasks_done / m.tasks_due) : m.tasks_done > 0 ? 1 : 0;
  return Math.round(0.5 * m.adherence_pct + 0.2 * m.on_time_pct + 30 * taskRate);
};

export const computeMemberReport = (input: MemberInput, dates: string[], nowMs: number): MemberReport => {
  const tz = input.user.timezone;
  const period: Interval = { start: dayRange(dates[0], tz).startMs, end: dayRange(dates[dates.length - 1], tz).endMs };
  const elapsed: Interval = { start: period.start, end: Math.min(period.end, nowMs) };

  const focusEntries = input.entries.filter((e) => e.mode === "focus");
  const focus = mergeIntervals(clip(focusEntries.map((e) => toInterval(e.started_at, e.ended_at)), period));
  const allPlanned = mergeIntervals(clip(input.blocks.map((b) => toInterval(b.starts_at, b.ends_at)), period));
  const planned = clip(allPlanned, elapsed);
  const onPlan = intersect(focus, planned);

  const plannedMin = msToMin(totalMs(planned));
  const focusMin = msToMin(totalMs(focus));
  const onPlanMin = msToMin(totalMs(onPlan));

  // Per-block outcomes for blocks that have started.
  const outcomes: BlockOutcome[] = input.blocks
    .filter((b) => new Date(b.starts_at).getTime() < Math.min(nowMs, period.end) && new Date(b.ends_at).getTime() > period.start)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((b) => {
      const iv = clip([toInterval(b.starts_at, b.ends_at)], elapsed);
      const plannedB = msToMin(totalMs(iv));
      const overlap = intersect(focus, iv);
      const attended = msToMin(totalMs(overlap));
      const late = overlap.length ? Math.max(0, msToMin(overlap[0].start - new Date(b.starts_at).getTime())) : null;
      return {
        block_id: b.id,
        title: b.title,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        planned_min: r1(plannedB),
        attended_min: r1(attended),
        attended_pct: pct(attended, plannedB),
        late_min: late === null ? null : r1(late),
        shared: b.participant_ids.length > 1
      };
    });

  const finished = outcomes.filter((o) => new Date(o.ends_at).getTime() <= nowMs);
  const started = outcomes.filter((o) => o.late_min !== null);
  const lateValues = started.map((o) => o.late_min as number);
  const onTime = started.filter((o) => (o.late_min as number) <= ON_TIME_GRACE_MIN).length;

  // Daily series + start-of-day habit.
  const series: DaySeriesPoint[] = [];
  const startMinutes: number[] = [];
  for (const date of dates) {
    const day = dayRange(date, tz);
    const dayIv: Interval = { start: day.startMs, end: day.endMs };
    const dayElapsed: Interval = { start: day.startMs, end: Math.min(day.endMs, nowMs) };
    const f = clip(focus, dayIv);
    const p = clip(allPlanned, dayElapsed);
    series.push({
      date,
      planned_min: r1(msToMin(totalMs(p))),
      focus_min: r1(msToMin(totalMs(f))),
      on_plan_min: r1(msToMin(totalMs(intersect(f, p))))
    });
    if (f.length) startMinutes.push(msToMin(f[0].start - zonedMidnight(date, tz)));
  }

  // Best hour (local), weighted by focus minutes.
  const hours = new Array(24).fill(0);
  for (const iv of focus) {
    for (let t = iv.start; t < iv.end; ) {
      const next = Math.min(iv.end, Math.floor(t / 3_600_000) * 3_600_000 + 3_600_000);
      hours[hourInTz(t, tz)] += next - t;
      t = next;
    }
  }
  const maxHour = Math.max(...hours);
  const bestHour = maxHour > 0 ? hours.indexOf(maxHour) : null;

  // Focus by project.
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  const byProject = new Map<string | null, Interval[]>();
  for (const e of focusEntries) {
    const list = byProject.get(e.project_id) ?? [];
    list.push(toInterval(e.started_at, e.ended_at));
    byProject.set(e.project_id, list);
  }
  const projects: ProjectSlice[] = [...byProject.entries()]
    .map(([id, list]) => {
      const p = id ? projectById.get(id) : undefined;
      return {
        project_id: id,
        name: p?.name ?? "No project",
        color: p?.color ?? "#94a3b8",
        focus_min: r1(msToMin(totalMs(mergeIntervals(clip(list, period)))))
      };
    })
    .filter((p) => p.focus_min > 0)
    .sort((a, b) => b.focus_min - a.focus_min);

  const report: MemberReport = {
    user_id: input.user.id,
    name: input.user.name,
    timezone: tz,
    planned_min: r1(plannedMin),
    upcoming_min: r1(msToMin(totalMs(allPlanned)) - plannedMin),
    focus_min: r1(focusMin),
    on_plan_min: r1(onPlanMin),
    off_plan_min: r1(focusMin - onPlanMin),
    adherence_pct: pct(onPlanMin, plannedMin),
    blocks_planned: outcomes.length,
    blocks_started: started.length,
    blocks_skipped: finished.filter((o) => o.attended_pct < SKIP_THRESHOLD_PCT).length,
    avg_late_min: lateValues.length ? r1(lateValues.reduce((s, v) => s + v, 0) / lateValues.length) : null,
    on_time_pct: pct(onTime, outcomes.length),
    tasks_done: input.tasks_done,
    tasks_due: input.tasks_due,
    avg_start_min: startMinutes.length ? Math.round(startMinutes.reduce((s, v) => s + v, 0) / startMinutes.length) : null,
    active_days: startMinutes.length,
    best_hour: bestHour,
    score: 0,
    projects,
    series,
    blocks: outcomes
  };
  report.score = scoreOf(report);
  return report;
};

/** Shared blocks: how each accepted participant showed up. */
export const computeJointSessions = (
  blocks: ReportBlock[],
  reports: MemberReport[]
): JointSessionOutcome[] => {
  const byUser = new Map(reports.map((r) => [r.user_id, r]));
  return blocks
    .filter((b) => b.participant_ids.filter((id) => byUser.has(id)).length > 1)
    .map((b) => {
      const members = b.participant_ids
        .filter((id) => byUser.has(id))
        .map((id) => {
          const r = byUser.get(id)!;
          const o = r.blocks.find((x) => x.block_id === b.id);
          return {
            user_id: id,
            name: r.name,
            attended_min: o?.attended_min ?? 0,
            attended_pct: o?.attended_pct ?? 0,
            late_min: o?.late_min ?? null
          };
        });
      const anyOutcome = reports.flatMap((r) => r.blocks).find((x) => x.block_id === b.id);
      return {
        block_id: b.id,
        title: b.title,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        planned_min: anyOutcome?.planned_min ?? 0,
        members
      };
    })
    .filter((j) => j.planned_min > 0)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
};

const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

interface MetricDef {
  key: string;
  label: string;
  value: (r: MemberReport) => number | null;
  higherIsBetter: boolean;
  format: (v: number) => string;
  phrase: string;
  /** Minimum gap before we call a winner (avoid crowning noise). */
  minGap: number;
}

const METRICS: MetricDef[] = [
  { key: "score", label: "Overall score", value: (r) => r.score, higherIsBetter: true, format: (v) => `${v}/100`, phrase: "managed time best overall", minGap: 3 },
  { key: "adherence", label: "Plan adherence", value: (r) => (r.planned_min > 0 ? r.adherence_pct : null), higherIsBetter: true, format: (v) => `${Math.round(v)}%`, phrase: "stuck to the plan better", minGap: 5 },
  { key: "focus", label: "Focus time", value: (r) => r.focus_min, higherIsBetter: true, format: fmtDuration, phrase: "put in more focused time", minGap: 10 },
  { key: "punctuality", label: "Avg. lateness", value: (r) => r.avg_late_min, higherIsBetter: false, format: (v) => `${Math.round(v)}m late`, phrase: "started planned blocks closer to on time", minGap: 2 },
  { key: "start", label: "Day start", value: (r) => r.avg_start_min, higherIsBetter: false, format: clock, phrase: "got going earlier", minGap: 15 },
  { key: "tasks", label: "Tasks done", value: (r) => r.tasks_done, higherIsBetter: true, format: (v) => `${v}`, phrase: "finished more tasks", minGap: 1 },
  { key: "planned", label: "Time planned", value: (r) => r.planned_min + r.upcoming_min, higherIsBetter: true, format: fmtDuration, phrase: "planned more of the day", minGap: 15 }
];

export const computeVerdicts = (reports: MemberReport[]): Verdict[] => {
  if (reports.length < 2) return [];
  const verdicts: Verdict[] = [];
  for (const m of METRICS) {
    const vals = reports.map((r) => ({ r, v: m.value(r) })).filter((x): x is { r: MemberReport; v: number } => x.v !== null);
    if (vals.length < 2 || vals.every((x) => x.v === 0)) continue;
    vals.sort((a, b) => (m.higherIsBetter ? b.v - a.v : a.v - b.v));
    const [best, second] = vals;
    const gap = Math.abs(best.v - second.v);
    if (gap < m.minGap) {
      verdicts.push({ metric: m.label, winner_id: null, text: `Even on ${m.label.toLowerCase()} (${vals.map((x) => `${x.r.name} ${m.format(x.v)}`).join(", ")}).` });
      continue;
    }
    const others = vals.slice(1).map((x) => `${x.r.name} ${m.format(x.v)}`).join(", ");
    verdicts.push({ metric: m.label, winner_id: best.r.user_id, text: `${best.r.name} ${m.phrase}: ${m.format(best.v)} vs ${others}.` });
  }
  return verdicts;
};
