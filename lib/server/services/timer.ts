import { getDb, Queryable } from "../db";
import { badRequest, notFound } from "../http";
import type { TimeEntry, Timer, TimerMode } from "@/lib/shared/types";

/**
 * Timer model:
 *   timers       — one mutable row per user: what's running right now (shared by all devices)
 *   time_entries — append-only facts: every closed segment of real time
 * Pause/stop close the current segment into time_entries. Reports only ever read time_entries,
 * so a crashed tab or a second device can never corrupt history.
 * Actions are idempotent (pausing a paused timer is a no-op) so double-taps across devices are harmless.
 */

const MAX_SEGMENT_HOURS = 16;

const lock = async (q: Queryable, userId: string) =>
  (await q.query<Timer>("select * from timers where user_id = $1 for update", [userId]))[0] ?? null;

export const getTimer = async (userId: string): Promise<Timer | null> => {
  const db = await getDb();
  return (await db.query<Timer>("select * from timers where user_id = $1", [userId]))[0] ?? null;
};

const closeSegment = async (q: Queryable, userId: string, t: Timer, endIso: string) => {
  if (t.status !== "running" || !t.segment_started_at) return 0;
  const startMs = new Date(t.segment_started_at).getTime();
  const endMs = new Date(endIso).getTime();
  const sec = Math.floor((endMs - startMs) / 1000);
  if (sec >= 1) {
    await q.query(
      `insert into time_entries(user_id, project_id, task_id, block_id, label, mode, source, started_at, ended_at, include_in_reports)
       values ($1, $2, $3, $4, $5, $6, 'timer', $7, $8, $9)`,
      [userId, t.project_id, t.task_id, t.block_id, t.label, t.mode, t.segment_started_at, endIso, t.include_in_reports]
    );
  }
  return Math.max(0, sec);
};

export interface StartInput {
  project_id?: string | null;
  task_id?: string | null;
  block_id?: string | null;
  label?: string | null;
  mode?: TimerMode;
  planned_sec?: number | null;
  /** Defaults to the block's setting when starting from a block, else true. */
  include_in_reports?: boolean;
}

/** Start a timer. If one is already going, it is stopped and saved first (i.e. "switch"). */
export const startTimer = async (userId: string, input: StartInput) => {
  const db = await getDb();
  return db.tx(async (q) => {
    if (input.project_id) {
      const ok = await q.query("select 1 from projects where id = $1 and user_id = $2", [input.project_id, userId]);
      if (!ok.length) throw badRequest("Unknown project");
    }
    if (input.task_id) {
      const ok = await q.query("select 1 from tasks where id = $1 and user_id = $2", [input.task_id, userId]);
      if (!ok.length) throw badRequest("Unknown task");
    }
    let include = input.include_in_reports;
    if (input.block_id) {
      const ok = await q.query<{ include_in_reports: boolean }>(
        `select b.include_in_reports from block_participants bp join plan_blocks b on b.id = bp.block_id
          where bp.block_id = $1 and bp.user_id = $2 and bp.status = 'accepted'`,
        [input.block_id, userId]
      );
      if (!ok.length) throw badRequest("Unknown block");
      include ??= ok[0].include_in_reports;
    }
    const now = new Date().toISOString();
    const existing = await lock(q, userId);
    if (existing) {
      await closeSegment(q, userId, existing, now);
      await q.query("delete from timers where user_id = $1", [userId]);
    }
    const rows = await q.query<Timer>(
      `insert into timers(user_id, project_id, task_id, block_id, label, mode, planned_sec, status,
                          session_started_at, segment_started_at, accumulated_sec, version, updated_at, include_in_reports)
       values ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $8, 0, $9, $8, $10) returning *`,
      [
        userId,
        input.project_id ?? null,
        input.task_id ?? null,
        input.block_id ?? null,
        input.label ?? null,
        input.mode ?? "focus",
        input.planned_sec ?? null,
        now,
        (existing?.version ?? 0) + 1,
        include ?? true
      ]
    );
    return rows[0];
  });
};

export const pauseTimer = async (userId: string) => {
  const db = await getDb();
  return db.tx(async (q) => {
    const t = await lock(q, userId);
    if (!t || t.status === "paused") return t;
    const now = new Date().toISOString();
    const sec = await closeSegment(q, userId, t, now);
    const rows = await q.query<Timer>(
      `update timers set status = 'paused', segment_started_at = null, accumulated_sec = accumulated_sec + $2,
              version = version + 1, updated_at = $3 where user_id = $1 returning *`,
      [userId, sec, now]
    );
    return rows[0];
  });
};

export const resumeTimer = async (userId: string) => {
  const db = await getDb();
  return db.tx(async (q) => {
    const t = await lock(q, userId);
    if (!t || t.status === "running") return t;
    const now = new Date().toISOString();
    const rows = await q.query<Timer>(
      `update timers set status = 'running', segment_started_at = $2, version = version + 1, updated_at = $2
        where user_id = $1 returning *`,
      [userId, now]
    );
    return rows[0];
  });
};

/**
 * Flip whether the running session counts in reports. Applies to the current segment and
 * anything after it; already-closed segments keep their own setting (edit those as entries).
 */
export const setTimerInclude = async (userId: string, include: boolean) => {
  const db = await getDb();
  const rows = await db.query<Timer>(
    "update timers set include_in_reports = $2, version = version + 1, updated_at = now() where user_id = $1 returning *",
    [userId, include]
  );
  return rows[0] ?? null;
};

/**
 * Stop and save. `atIso` lets you be honest about a forgotten timer:
 * "I actually stopped at 18:40" — it must fall inside the current running segment.
 */
export const stopTimer = async (userId: string, atIso?: string) => {
  const db = await getDb();
  return db.tx(async (q) => {
    const t = await lock(q, userId);
    if (!t) return null;
    let end = new Date().toISOString();
    if (atIso) {
      const at = new Date(atIso).getTime();
      const segStart = t.segment_started_at ? new Date(t.segment_started_at).getTime() : null;
      if (t.status !== "running" || segStart === null) throw badRequest("Timer is paused; just stop it");
      if (at < segStart || at > Date.now()) throw badRequest("Stop time must be between when this segment started and now");
      end = new Date(at).toISOString();
    } else if (t.segment_started_at && Date.now() - new Date(t.segment_started_at).getTime() > MAX_SEGMENT_HOURS * 3_600_000) {
      throw badRequest(`This timer has been running over ${MAX_SEGMENT_HOURS}h. Pick the time you actually stopped.`, {
        needs_stop_time: true
      });
    }
    await closeSegment(q, userId, t, end);
    await q.query("delete from timers where user_id = $1", [userId]);
    return null;
  });
};

// ───────────── entries (history + manual logging) ─────────────

export const listEntries = async (userId: string, fromIso: string, toIso: string) => {
  const db = await getDb();
  return db.query<TimeEntry>(
    `select id, project_id, task_id, block_id, label, mode, source, include_in_reports, started_at, ended_at
       from time_entries where user_id = $1 and started_at < $3 and ended_at > $2 order by started_at`,
    [userId, fromIso, toIso]
  );
};

export const addManualEntry = async (
  userId: string,
  e: {
    started_at: string;
    ended_at: string;
    project_id?: string | null;
    task_id?: string | null;
    label?: string | null;
    mode?: TimerMode;
    include_in_reports?: boolean;
  }
) => {
  const s = new Date(e.started_at).getTime();
  const en = new Date(e.ended_at).getTime();
  if (!(en > s)) throw badRequest("End must be after start");
  if (en > Date.now() + 60_000) throw badRequest("You can only log time that already happened");
  if (en - s > MAX_SEGMENT_HOURS * 3_600_000) throw badRequest(`At most ${MAX_SEGMENT_HOURS}h per entry`);
  const db = await getDb();
  if (e.project_id) {
    const ok = await db.query("select 1 from projects where id = $1 and user_id = $2", [e.project_id, userId]);
    if (!ok.length) throw badRequest("Unknown project");
  }
  const rows = await db.query<TimeEntry>(
    `insert into time_entries(user_id, project_id, task_id, label, mode, source, started_at, ended_at, include_in_reports)
     values ($1, $2, $3, $4, $5, 'manual', $6, $7, $8)
     returning id, project_id, task_id, block_id, label, mode, source, include_in_reports, started_at, ended_at`,
    [
      userId,
      e.project_id ?? null,
      e.task_id ?? null,
      e.label ?? null,
      e.mode ?? "focus",
      new Date(s).toISOString(),
      new Date(en).toISOString(),
      e.include_in_reports ?? true
    ]
  );
  return rows[0];
};

export const setEntryInclude = async (userId: string, id: string, include: boolean) => {
  const db = await getDb();
  const rows = await db.query<TimeEntry>(
    `update time_entries set include_in_reports = $3 where id = $1 and user_id = $2
     returning id, project_id, task_id, block_id, label, mode, source, include_in_reports, started_at, ended_at`,
    [id, userId, include]
  );
  if (!rows[0]) throw notFound();
  return rows[0];
};

export const deleteEntry = async (userId: string, id: string) => {
  const db = await getDb();
  await db.query("delete from time_entries where id = $1 and user_id = $2", [id, userId]);
};
