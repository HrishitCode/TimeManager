import { eachDayOfInterval, format, subDays } from "date-fns";
import { Session, Task } from "@/types/domain";

export interface HourBucket {
  hour: number;
  focusSeconds: number;
}

export interface TrendPoint {
  label: string;
  focusSeconds: number;
}

export const buildHourBuckets = (sessions: Session[]): HourBucket[] => {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, focusSeconds: 0 }));
  sessions
    .filter((session) => session.mode === "focus")
    .forEach((session) => {
      const hour = new Date(session.started_at).getHours();
      buckets[hour].focusSeconds += session.actual_duration_sec;
    });
  return buckets;
};

export const getMostProductiveHour = (buckets: HourBucket[]): HourBucket => {
  if (!buckets.length) {
    return { hour: 0, focusSeconds: 0 };
  }
  return buckets.reduce((max, item) => (item.focusSeconds > max.focusSeconds ? item : max), buckets[0]);
};

export const buildTrend = (sessions: Session[], days = 7): TrendPoint[] => {
  const end = new Date();
  const start = subDays(end, days - 1);
  const allDays = eachDayOfInterval({ start, end });

  return allDays.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const focusSeconds = sessions
      .filter((session) => session.mode === "focus" && session.started_at.startsWith(dateKey))
      .reduce((sum, session) => sum + session.actual_duration_sec, 0);
    return {
      label: format(day, "MMM d"),
      focusSeconds
    };
  });
};

export const buildTaskBreakdown = (tasks: Task[]) => {
  const done = tasks.filter((task) => task.status === "done").length;
  const skipped = tasks.filter((task) => task.status === "skipped").length;
  const todo = tasks.filter((task) => task.status === "todo").length;
  const total = tasks.length;
  return {
    done,
    skipped,
    todo,
    total,
    completionRate: total ? (done / total) * 100 : 0,
    skippedRate: total ? (skipped / total) * 100 : 0,
    carryOver: todo
  };
};
