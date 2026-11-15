import { getDb } from "../db";
import { getWorkspaceFor } from "./workspace";
import { computeJointSessions, computeMemberReport, computeVerdicts, MemberInput, ReportBlock, ReportEntry } from "@/lib/shared/report";
import { addDays, dateInTz, datesBetween, dayRange, weekStart } from "@/lib/shared/time";
import type { MemberStatus, Timer, User, WorkspaceReport } from "@/lib/shared/types";

type Person = Pick<User, "id" | "name" | "timezone">;

const peopleFor = async (user: User): Promise<Person[]> => {
  const ws = await getWorkspaceFor(user.id);
  return ws ? ws.members.map((m) => ({ id: m.id, name: m.name, timezone: m.timezone })) : [user];
};

/** Focus entries in a window, plus the live running segment (so "today" is accurate mid-session). */
const loadEntries = async (userId: string, fromIso: string, toIso: string, nowIso: string): Promise<ReportEntry[]> => {
  const db = await getDb();
  const entries = await db.query<ReportEntry>(
    `select project_id, mode, started_at, ended_at from time_entries
      where user_id = $1 and started_at < $3 and ended_at > $2`,
    [userId, fromIso, toIso]
  );
  const [t] = await db.query<Timer>("select * from timers where user_id = $1 and status = 'running'", [userId]);
  if (t?.segment_started_at && t.segment_started_at < nowIso) {
    entries.push({ project_id: t.project_id, mode: t.mode, started_at: t.segment_started_at, ended_at: nowIso });
  }
  return entries;
};

const loadMemberInput = async (p: Person, dates: string[], nowIso: string): Promise<MemberInput> => {
  const db = await getDb();
  const from = new Date(dayRange(dates[0], p.timezone).startMs).toISOString();
  const to = new Date(dayRange(dates[dates.length - 1], p.timezone).endMs).toISOString();

  const [blocks, entries, tasksDone, tasksDue, projects] = await Promise.all([
    db.query<ReportBlock>(
      `select b.id, b.title, b.starts_at, b.ends_at,
              array(select x.user_id::text from block_participants x where x.block_id = b.id and x.status = 'accepted') as participant_ids
         from plan_blocks b join block_participants bp on bp.block_id = b.id
        where bp.user_id = $1 and bp.status = 'accepted' and b.starts_at < $3 and b.ends_at > $2`,
      [p.id, from, to]
    ),
    loadEntries(p.id, from, to, nowIso),
    db.query<{ n: number }>("select count(*)::int as n from tasks where user_id = $1 and completed_at >= $2 and completed_at < $3", [
      p.id,
      from,
      to
    ]),
    db.query<{ n: number }>("select count(*)::int as n from tasks where user_id = $1 and due_date between $2 and $3", [
      p.id,
      dates[0],
      dates[dates.length - 1]
    ]),
    db.query<{ id: string; name: string; color: string }>("select id, name, color from projects where user_id = $1", [p.id])
  ]);

  return { user: p, blocks, entries, tasks_done: tasksDone[0].n, tasks_due: tasksDue[0].n, projects };
};

export const buildReport = async (viewer: User, period: "day" | "week", date: string): Promise<WorkspaceReport> => {
  const dates = period === "day" ? [date] : datesBetween(weekStart(date), addDays(weekStart(date), 6));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const people = await peopleFor(viewer);
  const inputs = await Promise.all(people.map((p) => loadMemberInput(p, dates, nowIso)));
  const members = inputs.map((i) => computeMemberReport(i, dates, now));

  const allBlocks = new Map<string, ReportBlock>();
  inputs.forEach((i) => i.blocks.forEach((b) => allBlocks.set(b.id, b)));

  // Put the viewer first so the UI can label them "You".
  members.sort((a, b) => (a.user_id === viewer.id ? -1 : b.user_id === viewer.id ? 1 : 0));

  return {
    period,
    date,
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    members,
    joint_sessions: computeJointSessions([...allBlocks.values()], members),
    verdicts: computeVerdicts(members)
  };
};

/** Live strip: what each workspace member is doing right now. */
export const memberStatuses = async (viewer: User): Promise<MemberStatus[]> => {
  const db = await getDb();
  const people = await peopleFor(viewer);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  return Promise.all(
    people.map(async (p) => {
      const [timer] = await db.query<MemberStatus["timer"] & object>(
        `select t.*, pr.name as project_name, tk.title as task_title
           from timers t left join projects pr on pr.id = t.project_id left join tasks tk on tk.id = t.task_id
          where t.user_id = $1`,
        [p.id]
      );
      const [block] = await db.query<{ title: string; ends_at: string }>(
        `select b.title, b.ends_at from plan_blocks b join block_participants bp on bp.block_id = b.id
          where bp.user_id = $1 and bp.status = 'accepted' and b.starts_at <= $2 and b.ends_at > $2 limit 1`,
        [p.id, nowIso]
      );
      const today = dateInTz(now, p.timezone);
      const r = dayRange(today, p.timezone);
      const entries = await loadEntries(p.id, new Date(r.startMs).toISOString(), new Date(r.endMs).toISOString(), nowIso);
      const report = computeMemberReport({ user: p, blocks: [], entries, tasks_done: 0, tasks_due: 0, projects: [] }, [today], now);
      return {
        user_id: p.id,
        name: p.name,
        timer: timer ?? null,
        current_block: block ?? null,
        focus_today_min: report.focus_min
      };
    })
  );
};
