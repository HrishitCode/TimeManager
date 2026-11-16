// Pure report computation. No I/O: callers load rows, this turns them into numbers.
// Everything is interval math over two sets per person: PLANNED (accepted blocks) and DONE (focus entries).

import type { BlockOutcome, DaySeriesPoint, JointSessionOutcome, MemberReport, ProjectSlice, Verdict } from "./types";
import { clip, dayRange, fmtDuration, hourInTz, intersect, Interval, mergeIntervals, msToMin, subtract, toInterval, totalMs, zonedMidnight } from "./time";

export interface ReportBlock {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  /** Accepted participant ids (owner included). */
  participant_ids: string[];
  /** false = "don't judge me on this" (e.g. office). The block's whole window is removed from the report. */
  include?: boolean;
}

export interface ReportEntry {
  project_id: string | null;
  mode: "focus" | "break";
  started_at: string;
  ended_at: string;
  /** false = ignored by reports. */
  include?: boolean;
}

export interface MemberInput {
  /** day_start_min/day_end_min: the person's day window in local minutes (default 07:00–23:00). */
  user: { id: string; name: string; timezone: string; day_start_min?: number; day_end_min?: number };
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

export const DEFAULT_DAY_START_MIN = 7 * 60;
export const DEFAULT_DAY_END_MIN = 23 * 60;
/** Planning at least this share of your countable time earns full marks for "how much you planned". */
export const PLAN_COVERAGE_TARGET = 0.5;

/**
 * Discipline (0–100): did you make a real plan, and did you keep it? Weights:
 *   45  fulfilled   — on-plan focus ÷ planned time (adherence)
 *   20  planned     — planned time ÷ (50% of countable time), capped at 1
 *   15  on time     — share of planned blocks where focus began within 5 minutes
 *   20  tasks       — tasks done ÷ tasks due (only if something was due; otherwise the other weights rescale)
 * No plan at all ⇒ the first three are 0. Null when there was no countable time yet.
 * Deliberately separate from *how much* you worked, see computeHeadline().
 */
export const disciplineOf = (
  m: Pick<MemberReport, "countable_min" | "planned_min" | "adherence_pct" | "blocks_planned" | "on_time_pct" | "tasks_done" | "tasks_due">
): number | null => {
  if (m.countable_min <= 0) return null;
  const parts: [number, number][] = [
    [45, m.planned_min > 0 ? m.adherence_pct / 100 : 0],
    [20, Math.min(1, m.planned_min / (PLAN_COVERAGE_TARGET * m.countable_min))],
    [15, m.blocks_planned > 0 ? m.on_time_pct / 100 : 0]
  ];
  if (m.tasks_due > 0) parts.push([20, Math.min(1, m.tasks_done / m.tasks_due)]);
  const weight = parts.reduce((s, [w]) => s + w, 0);
  return Math.round((100 * parts.reduce((s, [w, v]) => s + w * v, 0)) / weight);
};

/** The person's day windows (local) for each date, as UTC intervals. */
const dayWindows = (dates: string[], tz: string, startMin: number, endMin: number): Interval[] =>
  dates.map((d) => {
    const midnight = zonedMidnight(d, tz);
    return { start: midnight + startMin * 60_000, end: midnight + endMin * 60_000 };
  });

export const computeMemberReport = (input: MemberInput, dates: string[], nowMs: number): MemberReport => {
  const tz = input.user.timezone;
  const period: Interval = { start: dayRange(dates[0], tz).startMs, end: dayRange(dates[dates.length - 1], tz).endMs };
  const elapsed: Interval = { start: period.start, end: Math.min(period.end, nowMs) };

  // Opt-outs: excluded entries vanish; excluded blocks punch their whole window out of both
  // the plan and the tracked time (focus during office hours shouldn't count either way).
  const blocks = input.blocks.filter((b) => b.include !== false);
  const excluded = mergeIntervals(clip(input.blocks.filter((b) => b.include === false).map((b) => toInterval(b.starts_at, b.ends_at)), period));
  const focusEntries = input.entries.filter((e) => e.mode === "focus" && e.include !== false);
  const focus = subtract(clip(focusEntries.map((e) => toInterval(e.started_at, e.ended_at)), period), excluded);
  const allPlanned = subtract(clip(blocks.map((b) => toInterval(b.starts_at, b.ends_at)), period), excluded);
  const planned = clip(allPlanned, elapsed);
  const onPlan = intersect(focus, planned);

  const plannedMin = msToMin(totalMs(planned));
  const focusMin = msToMin(totalMs(focus));
  const onPlanMin = msToMin(totalMs(onPlan));

  // Countable time: your day window, widened by anything you actually planned or worked outside it,
  // minus opted-out time, up to now. This is "how much time did you really have?"
  const windows = dayWindows(dates, tz, input.user.day_start_min ?? DEFAULT_DAY_START_MIN, input.user.day_end_min ?? DEFAULT_DAY_END_MIN);
  const countable = clip(subtract([...windows, ...focus, ...allPlanned], excluded), elapsed);
  const countableMin = msToMin(totalMs(countable));

  // Per-block outcomes for blocks that have started.
  const outcomes: BlockOutcome[] = blocks
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
        focus_min: r1(msToMin(totalMs(subtract(clip(list, period), excluded))))
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
    excluded_min: r1(msToMin(totalMs(clip(excluded, elapsed)))),
    countable_min: r1(countableMin),
    focus_min: r1(focusMin),
    focus_share_pct: pct(focusMin, countableMin),
    planned_share_pct: pct(plannedMin, countableMin),
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
    discipline_score: null,
    projects,
    series,
    blocks: outcomes
  };
  report.discipline_score = disciplineOf(report);
  return report;
};

/** Shared blocks: how each accepted participant showed up. */
export const computeJointSessions = (
  blocks: ReportBlock[],
  reports: MemberReport[]
): JointSessionOutcome[] => {
  const byUser = new Map(reports.map((r) => [r.user_id, r]));
  return blocks
    .filter((b) => b.include !== false)
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
  section: Verdict["section"];
  label: string;
  value: (r: MemberReport) => number | null;
  higherIsBetter: boolean;
  format: (v: number) => string;
  phrase: string;
  /** Minimum gap before we call a winner (avoid crowning noise). */
  minGap: number;
}

const pctFmt = (v: number) => `${Math.round(v)}%`;

const METRICS: MetricDef[] = [
  // 2 · Work: how much did each person actually do?
  { section: "work", label: "Focused time", value: (r) => r.focus_min, higherIsBetter: true, format: fmtDuration, phrase: "worked more", minGap: 10 },
  { section: "work", label: "Use of countable time", value: (r) => (r.countable_min > 0 ? r.focus_share_pct : null), higherIsBetter: true, format: pctFmt, phrase: "used a bigger share of their available time", minGap: 3 },
  // 3 · Discipline: did they plan, and keep the plan?
  { section: "discipline", label: "Discipline", value: (r) => r.discipline_score, higherIsBetter: true, format: (v) => `${v}/100`, phrase: "was more disciplined", minGap: 3 },
  { section: "discipline", label: "Plan fulfilled", value: (r) => (r.planned_min > 0 ? r.adherence_pct : null), higherIsBetter: true, format: pctFmt, phrase: "kept more of their plan", minGap: 5 },
  { section: "discipline", label: "Time planned", value: (r) => (r.countable_min > 0 ? r.planned_share_pct : null), higherIsBetter: true, format: pctFmt, phrase: "planned more of their countable time", minGap: 5 },
  { section: "discipline", label: "Avg. lateness", value: (r) => r.avg_late_min, higherIsBetter: false, format: (v) => `${Math.round(v)}m late`, phrase: "started planned blocks closer to on time", minGap: 2 },
  { section: "discipline", label: "Tasks done", value: (r) => r.tasks_done, higherIsBetter: true, format: (v) => `${v}`, phrase: "finished more tasks", minGap: 1 },
  { section: "discipline", label: "Day start", value: (r) => r.avg_start_min, higherIsBetter: false, format: clock, phrase: "got going earlier", minGap: 15 }
];

export const computeVerdicts = (reports: MemberReport[]): Verdict[] => {
  if (reports.length < 2) return [];
  // 1 · Countable time: context, not a contest. Different office hours shouldn't decide who "wins".
  const verdicts: Verdict[] = [];
  const countables = reports.map((r) => r.countable_min);
  if (Math.max(...countables) > 0) {
    const parts = reports.map((r) => `${r.name} ${fmtDuration(r.countable_min)}${r.excluded_min > 0 ? ` (${fmtDuration(r.excluded_min)} left out)` : ""}`);
    const gap = Math.max(...countables) - Math.min(...countables);
    verdicts.push({
      section: "time",
      metric: "Countable time",
      winner_id: null,
      text: gap >= 60
        ? `Not the same amount of time to work with: ${parts.join(" vs ")}. Compare shares, not just hours.`
        : `Similar time available: ${parts.join(" vs ")}.`
    });
  }
  for (const m of METRICS) {
    const vals = reports.map((r) => ({ r, v: m.value(r) })).filter((x): x is { r: MemberReport; v: number } => x.v !== null);
    if (vals.length < 2 || vals.every((x) => x.v === 0)) continue;
    vals.sort((a, b) => (m.higherIsBetter ? b.v - a.v : a.v - b.v));
    const [best, second] = vals;
    if (Math.abs(best.v - second.v) < m.minGap) {
      verdicts.push({ section: m.section, metric: m.label, winner_id: null, text: `Even on ${m.label.toLowerCase()} (${vals.map((x) => `${x.r.name} ${m.format(x.v)}`).join(", ")}).` });
      continue;
    }
    const others = vals.slice(1).map((x) => `${x.r.name} ${m.format(x.v)}`).join(", ");
    verdicts.push({ section: m.section, metric: m.label, winner_id: best.r.user_id, text: `${best.r.name} ${m.phrase}: ${m.format(best.v)} vs ${others}.` });
  }
  return verdicts;
};

/**
 * One sentence that keeps "how much" and "how well" apart, because they can disagree:
 * someone can skip their plan and still out-work everyone.
 */
export const computeHeadline = (reports: MemberReport[], verdicts: Verdict[]): string | null => {
  if (reports.length < 2) return null;
  const nameOf = (id: string | null) => reports.find((r) => r.user_id === id)?.name ?? null;
  const work = verdicts.find((v) => v.metric === "Focused time");
  const disc = verdicts.find((v) => v.metric === "Discipline");
  const worker = nameOf(work?.winner_id ?? null);
  const disciplined = nameOf(disc?.winner_id ?? null);
  const hours = (n: string) => fmtDuration(reports.find((r) => r.name === n)!.focus_min);
  const score = (n: string) => reports.find((r) => r.name === n)!.discipline_score;
  const others = (n: string) => reports.filter((r) => r.name !== n);

  if (!work && !disc) return "Not enough planned or tracked time yet to compare.";
  if (worker && disciplined && worker === disciplined) {
    return `${worker} led on both: more work (${hours(worker)}) and more discipline (${score(worker)}/100).`;
  }
  if (worker && disciplined) {
    return `${worker} worked more (${hours(worker)} vs ${others(worker).map((r) => fmtDuration(r.focus_min)).join(", ")}), but ${disciplined} was more disciplined (${score(disciplined)} vs ${others(disciplined).map((r) => r.discipline_score ?? "—").join(", ")}).`;
  }
  if (worker) return `${worker} worked more (${hours(worker)}); discipline was about even.`;
  if (disciplined) return `About the same amount of work, but ${disciplined} was more disciplined (${score(disciplined)}/100).`;
  return "Neck and neck on both work and discipline.";
};
