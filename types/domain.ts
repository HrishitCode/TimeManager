export type TaskKind = "daily" | "future";
export type TaskStatus = "todo" | "done" | "skipped";
export type SessionMode = "focus" | "short_break" | "long_break";
export type SessionStatus = "running" | "paused" | "completed" | "stopped";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  color: string;
  archived_at: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  scheduled_for: string | null;
  priority: number | null;
  status: TaskStatus;
  recurrence_date: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface PomodoroConfig {
  id: string;
  user_id: string;
  focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string;
  mode: SessionMode;
  status: SessionStatus;
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
  planned_duration_sec: number;
  actual_duration_sec: number;
  overtime_sec: number;
  accepted_overtime: boolean;
}

export interface TimerState {
  user_id: string;
  active_session_id: string | null;
  state_version: number;
  updated_at: string;
  updated_by_device_id: string;
}

export interface TimerStateResponse {
  activeSession: Session | null;
  timerState: TimerState;
}

export interface TimeBooking {
  id: string;
  user_id: string;
  project_id: string;
  task_id: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export interface TimeBookingReminder {
  id: string;
  booking_id: string;
  reminder_type: "pre_start_10m" | "late_1m";
  sent_at: string;
}

export interface DailySlotReport {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  project_id: string;
  project_name: string;
  task_id: string | null;
  task_name: string;
  booked_minutes: number;
  performed_minutes: number;
  wasted_minutes: number;
  performed_pct: number;
  wasted_pct: number;
}

export interface DailyGroupReportRow {
  id: string;
  name: string;
  booked_minutes: number;
  performed_minutes: number;
  wasted_minutes: number;
  performed_pct: number;
  wasted_pct: number;
}

export interface DailyHourReportRow {
  hour: number;
  booked_minutes: number;
  performed_minutes: number;
  wasted_minutes: number;
}

export interface DailySummaryReport {
  booked_minutes: number;
  performed_minutes: number;
  wasted_minutes: number;
  utilization_pct: number;
}

export interface DailyReportsComparison {
  yesterday: {
    date: string;
    utilization_pct: number;
    delta_pct: number;
  };
  trailing_average_7d: {
    utilization_pct: number;
    delta_pct: number;
  };
}

export interface DailyReportsResponse {
  date: string;
  timezone: string;
  summary: DailySummaryReport;
  project_breakdown: DailyGroupReportRow[];
  task_breakdown: DailyGroupReportRow[];
  hour_breakdown: DailyHourReportRow[];
  slots: DailySlotReport[];
  most_productive_task: DailyGroupReportRow | null;
  least_productive_task: DailyGroupReportRow | null;
  comparison: DailyReportsComparison;
}
