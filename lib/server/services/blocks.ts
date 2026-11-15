import { getDb, Queryable } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { getWorkspaceFor, visibleUserIds } from "./workspace";
import type { Block, ParticipantStatus } from "@/lib/shared/types";

const MAX_BLOCK_HOURS = 16;

const BLOCK_SELECT = `
  select b.id, b.owner_id, ou.name as owner_name, b.workspace_id, b.title,
         b.project_id, p.name as project_name, p.color as project_color, b.task_id,
         b.starts_at, b.ends_at,
         coalesce((
           select json_agg(json_build_object('user_id', bp.user_id, 'name', pu.name, 'status', bp.status)
                           order by (bp.user_id = b.owner_id) desc, pu.name)
             from block_participants bp join users pu on pu.id = bp.user_id
            where bp.block_id = b.id
         ), '[]'::json) as participants
    from plan_blocks b
    join users ou on ou.id = b.owner_id
    left join projects p on p.id = b.project_id`;

export const getBlock = async (id: string, q?: Queryable): Promise<Block | null> => {
  const db = q ?? (await getDb());
  const rows = await db.query<Block>(`${BLOCK_SELECT} where b.id = $1`, [id]);
  return rows[0] ?? null;
};

/**
 * Calendar feed: every block in [from, to) that any visible user (me + workspace mates) has accepted,
 * plus blocks I've been invited to but haven't answered.
 */
export const listBlocks = async (userId: string, fromIso: string, toIso: string): Promise<Block[]> => {
  const db = await getDb();
  const visible = await visibleUserIds(userId, db);
  return db.query<Block>(
    `${BLOCK_SELECT}
      where b.starts_at < $3 and b.ends_at > $2
        and exists (
          select 1 from block_participants x
           where x.block_id = b.id
             and ((x.user_id = any($4::uuid[]) and x.status = 'accepted') or (x.user_id = $1 and x.status = 'invited'))
        )
      order by b.starts_at`,
    [userId, fromIso, toIso, visible]
  );
};

/** Blocks `userId` has accepted that overlap [start, end). */
export const findOverlap = async (q: Queryable, userId: string, startIso: string, endIso: string, excludeId?: string) => {
  const rows = await q.query<{ id: string; title: string; starts_at: string; ends_at: string }>(
    `select b.id, b.title, b.starts_at, b.ends_at
       from plan_blocks b join block_participants bp on bp.block_id = b.id
      where bp.user_id = $1 and bp.status = 'accepted'
        and b.starts_at < $3 and b.ends_at > $2
        and ($4::uuid is null or b.id <> $4::uuid)
      order by b.starts_at limit 1`,
    [userId, startIso, endIso, excludeId ?? null]
  );
  return rows[0] ?? null;
};

const assertOwnsRefs = async (q: Queryable, userId: string, projectId?: string | null, taskId?: string | null) => {
  if (projectId) {
    const r = await q.query("select 1 from projects where id = $1 and user_id = $2", [projectId, userId]);
    if (!r.length) throw badRequest("Unknown project");
  }
  if (taskId) {
    const r = await q.query("select 1 from tasks where id = $1 and user_id = $2", [taskId, userId]);
    if (!r.length) throw badRequest("Unknown task");
  }
};

const validateRange = (startIso: string, endIso: string) => {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!(e > s)) throw badRequest("End must be after start");
  if (e - s > MAX_BLOCK_HOURS * 3_600_000) throw badRequest(`A block can be at most ${MAX_BLOCK_HOURS} hours`);
};

const overlapError = (o: { title: string; starts_at: string; ends_at: string }) =>
  conflict(`Overlaps with "${o.title}"`, { overlap: o });

export interface BlockInput {
  title: string;
  starts_at: string;
  ends_at: string;
  project_id?: string | null;
  task_id?: string | null;
  invite_user_ids?: string[];
}

export const createBlock = async (userId: string, input: BlockInput) => {
  validateRange(input.starts_at, input.ends_at);
  const db = await getDb();
  const id = await db.tx(async (q) => {
    await assertOwnsRefs(q, userId, input.project_id, input.task_id);
    const overlap = await findOverlap(q, userId, input.starts_at, input.ends_at);
    if (overlap) throw overlapError(overlap);

    const invitees = [...new Set(input.invite_user_ids ?? [])].filter((id) => id !== userId);
    let workspaceId: string | null = null;
    if (invitees.length) {
      const ws = await getWorkspaceFor(userId, q);
      const memberIds = new Set(ws?.members.map((m) => m.id) ?? []);
      if (!ws || invitees.some((i) => !memberIds.has(i))) throw badRequest("You can only invite workspace members");
      workspaceId = ws.id;
    }

    const [row] = await q.query<{ id: string }>(
      `insert into plan_blocks(owner_id, workspace_id, title, project_id, task_id, starts_at, ends_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [userId, workspaceId, input.title, input.project_id ?? null, input.task_id ?? null, input.starts_at, input.ends_at]
    );
    await q.query("insert into block_participants(block_id, user_id, status, responded_at) values ($1, $2, 'accepted', now())", [
      row.id,
      userId
    ]);
    for (const inv of invitees) {
      await q.query("insert into block_participants(block_id, user_id, status) values ($1, $2, 'invited')", [row.id, inv]);
    }
    return row.id;
  });
  return getBlock(id);
};

export const updateBlock = async (userId: string, id: string, patch: Partial<Omit<BlockInput, "invite_user_ids">>) => {
  const db = await getDb();
  await db.tx(async (q) => {
    const current = await getBlock(id, q);
    if (!current) throw notFound();
    if (current.owner_id !== userId) throw forbidden("Only the organiser can edit this block");
    const next = { ...current, ...patch };
    validateRange(next.starts_at, next.ends_at);
    await assertOwnsRefs(q, userId, patch.project_id, patch.task_id);
    const timeChanged = next.starts_at !== current.starts_at || next.ends_at !== current.ends_at;
    if (timeChanged) {
      // Re-check every accepted participant's calendar.
      for (const p of current.participants.filter((x) => x.status === "accepted")) {
        const o = await findOverlap(q, p.user_id, next.starts_at, next.ends_at, id);
        if (o) throw conflict(p.user_id === userId ? `Overlaps with "${o.title}"` : `Clashes with ${p.name}'s "${o.title}"`, { overlap: o });
      }
    }
    await q.query(
      `update plan_blocks set title = $2, project_id = $3, task_id = $4, starts_at = $5, ends_at = $6 where id = $1`,
      [id, next.title, next.project_id, next.task_id, next.starts_at, next.ends_at]
    );
  });
  return getBlock(id);
};

/** Organiser deletes the block for everyone; anyone else just leaves it. */
export const deleteBlock = async (userId: string, id: string) => {
  const db = await getDb();
  const block = await getBlock(id, db);
  if (!block) throw notFound();
  if (block.owner_id === userId) {
    await db.query("delete from plan_blocks where id = $1", [id]);
    return { deleted: true };
  }
  if (!block.participants.some((p) => p.user_id === userId)) throw notFound();
  await db.query("update block_participants set status = 'declined', responded_at = now() where block_id = $1 and user_id = $2", [
    id,
    userId
  ]);
  return { deleted: false, left: true };
};

export const respondToBlock = async (userId: string, id: string, status: Exclude<ParticipantStatus, "invited">) => {
  const db = await getDb();
  await db.tx(async (q) => {
    const block = await getBlock(id, q);
    const me = block?.participants.find((p) => p.user_id === userId);
    if (!block || !me) throw notFound("Invitation not found");
    if (status === "accepted") {
      const o = await findOverlap(q, userId, block.starts_at, block.ends_at, id);
      if (o) throw conflict(`You already have "${o.title}" then. Move or delete it first.`, { overlap: o });
    }
    await q.query("update block_participants set status = $3, responded_at = now() where block_id = $1 and user_id = $2", [
      id,
      userId,
      status
    ]);
  });
  return getBlock(id);
};

/** Invite more people to an existing block (organiser only). */
export const inviteToBlock = async (userId: string, id: string, inviteeIds: string[]) => {
  const db = await getDb();
  await db.tx(async (q) => {
    const block = await getBlock(id, q);
    if (!block) throw notFound();
    if (block.owner_id !== userId) throw forbidden("Only the organiser can invite");
    const ws = await getWorkspaceFor(userId, q);
    const memberIds = new Set(ws?.members.map((m) => m.id) ?? []);
    for (const inv of inviteeIds) {
      if (inv === userId || !memberIds.has(inv)) continue;
      await q.query(
        `insert into block_participants(block_id, user_id, status) values ($1, $2, 'invited')
         on conflict (block_id, user_id) do update set status = 'invited', responded_at = null
         where block_participants.status = 'declined'`,
        [id, inv]
      );
    }
    if (ws) await q.query("update plan_blocks set workspace_id = $2 where id = $1", [id, ws.id]);
  });
  return getBlock(id);
};

/** Copy my own solo blocks from one local day to another, skipping any that would overlap. */
export const copyDay = async (userId: string, fromStartIso: string, fromEndIso: string, shiftMs: number) => {
  const db = await getDb();
  return db.tx(async (q) => {
    const source = await q.query<{ title: string; project_id: string | null; task_id: string | null; starts_at: string; ends_at: string }>(
      `select title, project_id, task_id, starts_at, ends_at from plan_blocks
        where owner_id = $1 and starts_at >= $2 and starts_at < $3 order by starts_at`,
      [userId, fromStartIso, fromEndIso]
    );
    let copied = 0;
    let skipped = 0;
    for (const b of source) {
      const s = new Date(new Date(b.starts_at).getTime() + shiftMs).toISOString();
      const e = new Date(new Date(b.ends_at).getTime() + shiftMs).toISOString();
      if (await findOverlap(q, userId, s, e)) {
        skipped++;
        continue;
      }
      const [row] = await q.query<{ id: string }>(
        `insert into plan_blocks(owner_id, title, project_id, task_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6) returning id`,
        [userId, b.title, b.project_id, b.task_id, s, e]
      );
      await q.query("insert into block_participants(block_id, user_id, status, responded_at) values ($1, $2, 'accepted', now())", [
        row.id,
        userId
      ]);
      copied++;
    }
    return { copied, skipped };
  });
};
