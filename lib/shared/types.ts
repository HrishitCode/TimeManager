// DTOs shared between API routes and the client. Timestamps are ISO-8601 UTC strings; dates are YYYY-MM-DD.

export interface User {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  timezone: string;
  role: "owner" | "member";
}

export interface Workspace {
  id: string;
  name: string;
  members: Member[];
}

export interface Me {
  user: User;
  workspace: Workspace | null;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  archived_at: string | null;
}

export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  notes: string | null;
  status: "todo" | "done";
  due_date: string | null;
  estimate_min: number | null;
  completed_at: string | null;
  created_at: string;
}

export type ParticipantStatus = "invited" | "accepted" | "declined";

export interface Participant {
  user_id: string;
  name: string;
  status: ParticipantStatus;
}

export interface Block {
  id: string;
  owner_id: string;
  owner_name: string;
  workspace_id: string | null;
  title: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  task_id: string | null;
  starts_at: string;
  ends_at: string;
  include_in_reports: boolean;
  participants: Participant[];
}

export type TimerMode = "focus" | "break";

export interface Timer {
  project_id: string | null;
  task_id: string | null;
  block_id: string | null;
  label: string | null;
  mode: TimerMode;
  planned_sec: number | null;
  include_in_reports: boolean;
  status: "running" | "paused";
  session_started_at: string;
  segment_started_at: string | null;
  accumulated_sec: number;
  version: number;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  project_id: string | null;
  task_id: string | null;
  block_id: string | null;
  label: string | null;
  mode: TimerMode;
  source: "timer" | "manual";
  include_in_reports: boolean;
  started_at: string;
  ended_at: string;
}

/** What a workspace mate is doing right now (for the "live" strip). */
export interface MemberStatus {
  user_id: string;
  name: string;
  timer: (Timer & { project_name: string | null; task_title: string | null }) | null;
  current_block: { title: string; ends_at: string } | null;
  focus_today_min: number;
}

// ───────────── reports ─────────────

export interface BlockOutcome {
  block_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  planned_min: number;
  attended_min: number;
  attended_pct: number;
  /** Minutes from block start to first tracked focus inside it; null if never started. */
  late_min: number | null;
  shared: boolean;
}

export interface ProjectSlice {
  project_id: string | null;
  name: string;
  color: string;
  focus_min: number;
}

export interface DaySeriesPoint {
  date: string;
  planned_min: number;
  focus_min: number;
  on_plan_min: number;
}

export interface MemberReport {
  user_id: string;
  name: string;
  timezone: string;
  /** Planned time that has already elapsed (future blocks don't count against you yet). */
  planned_min: number;
  /** Planned time still ahead within the period. */
  upcoming_min: number;
  /** Elapsed time inside blocks opted out of reports (e.g. office). */
  excluded_min: number;
  focus_min: number;
  on_plan_min: number;
  off_plan_min: number;
  /** on_plan / planned. The core "did you do what you said you'd do" number. */
  adherence_pct: number;
  blocks_planned: number;
  blocks_started: number;
  blocks_skipped: number;
  avg_late_min: number | null;
  on_time_pct: number;
  tasks_done: number;
  tasks_due: number;
  /** Average local minute-of-day of the first focus each active day (e.g. 450 = 07:30). */
  avg_start_min: number | null;
  active_days: number;
  best_hour: number | null;
  /** 0–100 composite; formula in lib/shared/report.ts → scoreOf(). */
  score: number;
  projects: ProjectSlice[];
  series: DaySeriesPoint[];
  blocks: BlockOutcome[];
}

export interface JointSessionOutcome {
  block_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  planned_min: number;
  members: { user_id: string; name: string; attended_min: number; attended_pct: number; late_min: number | null }[];
}

export interface Verdict {
  metric: string;
  winner_id: string | null;
  text: string;
}

export interface WorkspaceReport {
  period: "day" | "week";
  date: string;
  start_date: string;
  end_date: string;
  members: MemberReport[];
  joint_sessions: JointSessionOutcome[];
  verdicts: Verdict[];
}
