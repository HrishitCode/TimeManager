import { addDays, format } from "date-fns";
import { DailyGroupReportRow, DailyHourReportRow, DailyReportsResponse, DailySlotReport, Session, TimeBooking } from "@/types/domain";

const IST_OFFSET_MINUTES = 330;
export const DEFAULT_REPORT_TIMEZONE = "Asia/Kolkata";
const PRODUCTIVITY_MIN_BOOKED_MINUTES = 30;

type NamedProject = { id: string; name: string };
type NamedTask = { id: string; title: string };

interface Interval {
  startMs: number;
  endMs: number;
}

const clampPct = (num: number) => Math.max(0, Math.min(100, num));

const toMinutes = (ms: number) => Math.max(0, ms / 60_000);

export const dayWindowForIstDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MINUTES * 60_000;
  const start = new Date(startUtcMs);
  const end = new Date(startUtcMs + 24 * 60 * 60 * 1000);
  return { start, end };
};

export const todayIstDate = () => {
  const istNow = new Date(Date.now() + IST_OFFSET_MINUTES * 60_000);
  return istNow.toISOString().slice(0, 10);
};

export const addDaysToDateString = (date: string, offset: number) => {
  const anchor = new Date(`${date}T12:00:00.000Z`);
  return format(addDays(anchor, offset), "yyyy-MM-dd");
};

const mergeIntervals = (intervals: Interval[]) => {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
};

const intersectInterval = (a: Interval, b: Interval): Interval | null => {
  const startMs = Math.max(a.startMs, b.startMs);
  const endMs = Math.min(a.endMs, b.endMs);
  if (endMs <= startMs) return null;
  return { startMs, endMs };
};

const buildSessionIntervals = (sessions: Session[]): Interval[] =>
  sessions
    .filter((session) => session.mode === "focus")
    .map((session) => {
      const startMs = new Date(session.started_at).getTime();
      const endedAtMs = session.ended_at ? new Date(session.ended_at).getTime() : startMs + session.actual_duration_sec * 1000;
      return {
        startMs,
        endMs: Math.max(startMs, endedAtMs)
      };
    })
    .filter((interval) => interval.endMs > interval.startMs);

const buildHourBuckets = (dayStartMs: number) =>
  Array.from({ length: 24 }, (_, hour): DailyHourReportRow => ({
    hour,
    booked_minutes: 0,
    performed_minutes: 0,
    wasted_minutes: 0
  })).map((bucket) => ({
    ...bucket,
    _startMs: dayStartMs + bucket.hour * 60 * 60 * 1000,
    _endMs: dayStartMs + (bucket.hour + 1) * 60 * 60 * 1000
  }));

const toGroupRows = (input: Map<string, { name: string; booked: number; performed: number }>): DailyGroupReportRow[] =>
  Array.from(input.entries())
    .map(([id, item]) => {
      const wasted = Math.max(0, item.booked - item.performed);
      const performedPct = item.booked > 0 ? clampPct((item.performed / item.booked) * 100) : 0;
      return {
        id,
        name: item.name,
        booked_minutes: Number(item.booked.toFixed(2)),
        performed_minutes: Number(item.performed.toFixed(2)),
        wasted_minutes: Number(wasted.toFixed(2)),
        performed_pct: Number(performedPct.toFixed(2)),
        wasted_pct: Number((100 - performedPct).toFixed(2))
      };
    })
    .sort((a, b) => b.booked_minutes - a.booked_minutes || b.performed_minutes - a.performed_minutes || a.name.localeCompare(b.name));

export const computeDailyReport = ({
  date,
  timezone = DEFAULT_REPORT_TIMEZONE,
  bookings,
  sessions,
  projects,
  tasks
}: {
  date: string;
  timezone?: string;
  bookings: TimeBooking[];
  sessions: Session[];
  projects: NamedProject[];
  tasks: NamedTask[];
}): Omit<DailyReportsResponse, "comparison"> => {
  const { start, end } = dayWindowForIstDate(date);
  const dayInterval: Interval = { startMs: start.getTime(), endMs: end.getTime() };
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
  const taskNameById = new Map(tasks.map((task) => [task.id, task.title]));
  const sessionIntervals = mergeIntervals(
    buildSessionIntervals(sessions)
      .map((interval) => intersectInterval(interval, dayInterval))
      .filter((value): value is Interval => Boolean(value))
  );

  const hourBuckets = buildHourBuckets(dayInterval.startMs);
  const projectAgg = new Map<string, { name: string; booked: number; performed: number }>();
  const taskAgg = new Map<string, { name: string; booked: number; performed: number }>();
  const slotRows: DailySlotReport[] = [];

  let summaryBooked = 0;
  let summaryPerformed = 0;

  bookings.forEach((booking) => {
    const rawBooking: Interval = {
      startMs: new Date(booking.starts_at).getTime(),
      endMs: new Date(booking.ends_at).getTime()
    };
    const bookingInDay = intersectInterval(rawBooking, dayInterval);
    if (!bookingInDay) return;

    const overlapIntervals = sessionIntervals
      .map((sessionInterval) => intersectInterval(sessionInterval, bookingInDay))
      .filter((value): value is Interval => Boolean(value));
    const mergedOverlaps = mergeIntervals(overlapIntervals);
    const performedMs = mergedOverlaps.reduce((sum, interval) => sum + (interval.endMs - interval.startMs), 0);
    const bookedMs = bookingInDay.endMs - bookingInDay.startMs;
    const wastedMs = Math.max(0, bookedMs - performedMs);

    const bookedMinutes = toMinutes(bookedMs);
    const performedMinutes = toMinutes(performedMs);
    const wastedMinutes = toMinutes(wastedMs);
    const performedPct = bookedMinutes > 0 ? clampPct((performedMinutes / bookedMinutes) * 100) : 0;

    summaryBooked += bookedMinutes;
    summaryPerformed += performedMinutes;

    const projectName = projectNameById.get(booking.project_id) ?? "Project";
    const taskKey = booking.task_id ?? "__no_task__";
    const taskName = booking.task_id ? taskNameById.get(booking.task_id) ?? "Task" : "No task";

    const projectItem = projectAgg.get(booking.project_id) ?? { name: projectName, booked: 0, performed: 0 };
    projectItem.booked += bookedMinutes;
    projectItem.performed += performedMinutes;
    projectAgg.set(booking.project_id, projectItem);

    const taskItem = taskAgg.get(taskKey) ?? { name: taskName, booked: 0, performed: 0 };
    taskItem.booked += bookedMinutes;
    taskItem.performed += performedMinutes;
    taskAgg.set(taskKey, taskItem);

    hourBuckets.forEach((bucket) => {
      const hourInterval: Interval = { startMs: bucket._startMs, endMs: bucket._endMs };
      const bookingHourPart = intersectInterval(hourInterval, bookingInDay);
      if (!bookingHourPart) return;
      const bookedPartMs = bookingHourPart.endMs - bookingHourPart.startMs;
      let performedPartMs = 0;
      mergedOverlaps.forEach((overlap) => {
        const overlapInHour = intersectInterval(overlap, hourInterval);
        if (overlapInHour) {
          performedPartMs += overlapInHour.endMs - overlapInHour.startMs;
        }
      });
      bucket.booked_minutes += toMinutes(bookedPartMs);
      bucket.performed_minutes += toMinutes(performedPartMs);
      bucket.wasted_minutes += toMinutes(Math.max(0, bookedPartMs - performedPartMs));
    });

    slotRows.push({
      booking_id: booking.id,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      project_id: booking.project_id,
      project_name: projectName,
      task_id: booking.task_id,
      task_name: taskName,
      booked_minutes: Number(bookedMinutes.toFixed(2)),
      performed_minutes: Number(performedMinutes.toFixed(2)),
      wasted_minutes: Number(wastedMinutes.toFixed(2)),
      performed_pct: Number(performedPct.toFixed(2)),
      wasted_pct: Number((100 - performedPct).toFixed(2))
    });
  });

  slotRows.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const summaryWasted = Math.max(0, summaryBooked - summaryPerformed);
  const summaryUtilization = summaryBooked > 0 ? clampPct((summaryPerformed / summaryBooked) * 100) : 0;

  const projectRows = toGroupRows(projectAgg);
  const taskRows = toGroupRows(taskAgg);
  const taskRowsForProductivity = taskRows.filter((row) => row.booked_minutes >= PRODUCTIVITY_MIN_BOOKED_MINUTES);
  const mostProductiveTask =
    taskRowsForProductivity.length > 0
      ? [...taskRowsForProductivity].sort((a, b) => b.performed_pct - a.performed_pct || b.performed_minutes - a.performed_minutes)[0]
      : null;
  const leastProductiveTask =
    taskRowsForProductivity.length > 0
      ? [...taskRowsForProductivity].sort((a, b) => a.performed_pct - b.performed_pct || b.booked_minutes - a.booked_minutes)[0]
      : null;

  return {
    date,
    timezone,
    summary: {
      booked_minutes: Number(summaryBooked.toFixed(2)),
      performed_minutes: Number(summaryPerformed.toFixed(2)),
      wasted_minutes: Number(summaryWasted.toFixed(2)),
      utilization_pct: Number(summaryUtilization.toFixed(2))
    },
    project_breakdown: projectRows,
    task_breakdown: taskRows,
    hour_breakdown: hourBuckets.map((bucket) => ({
      hour: bucket.hour,
      booked_minutes: Number(bucket.booked_minutes.toFixed(2)),
      performed_minutes: Number(bucket.performed_minutes.toFixed(2)),
      wasted_minutes: Number(bucket.wasted_minutes.toFixed(2))
    })),
    slots: slotRows,
    most_productive_task: mostProductiveTask,
    least_productive_task: leastProductiveTask
  };
};
