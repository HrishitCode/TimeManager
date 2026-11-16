import crypto from "node:crypto";
import { getDb, Queryable } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";
import type { Member, Workspace } from "@/lib/shared/types";

const MAX_MEMBERS = 8;
const INVITE_DAYS = 14;

/** MVP: a user belongs to at most one workspace. The schema allows many; the UI uses the first. */
export const getWorkspaceFor = async (userId: string, q?: Queryable): Promise<Workspace | null> => {
  const db = q ?? (await getDb());
  const ws = await db.query<{ id: string; name: string }>(
    `select w.id, w.name from workspaces w join workspace_members m on m.workspace_id = w.id
      where m.user_id = $1 order by m.joined_at limit 1`,
    [userId]
  );
  if (!ws[0]) return null;
  const members = await db.query<Member>(
    `select u.id, u.name, u.email, u.timezone, u.day_start_min, u.day_end_min, m.role
       from workspace_members m join users u on u.id = m.user_id
      where m.workspace_id = $1 order by m.joined_at`,
    [ws[0].id]
  );
  return { ...ws[0], members };
};

/** Everyone whose calendar/stats `userId` may see: themselves + workspace mates. */
export const visibleUserIds = async (userId: string, q?: Queryable): Promise<string[]> => {
  const db = q ?? (await getDb());
  const rows = await db.query<{ id: string }>(
    `select $1::uuid as id
     union
     select m2.user_id from workspace_members m1
       join workspace_members m2 on m2.workspace_id = m1.workspace_id
      where m1.user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.id);
};

export const createWorkspace = async (userId: string, name: string) => {
  const db = await getDb();
  return db.tx(async (q) => {
    const existing = await getWorkspaceFor(userId, q);
    if (existing) throw conflict("You're already in a workspace. Leave it first to create another.");
    const [ws] = await q.query<{ id: string }>("insert into workspaces(name, created_by) values ($1, $2) returning id", [
      name,
      userId
    ]);
    await q.query("insert into workspace_members(workspace_id, user_id, role) values ($1, $2, 'owner')", [ws.id, userId]);
    return getWorkspaceFor(userId, q);
  });
};

const newCode = () => {
  // 8 chars, unambiguous alphabet (no 0/O/1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};

export const createInvite = async (userId: string) => {
  const db = await getDb();
  const ws = await getWorkspaceFor(userId);
  if (!ws) throw badRequest("Create a workspace first");
  const code = newCode();
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  await db.query("insert into workspace_invites(code, workspace_id, created_by, expires_at) values ($1, $2, $3, $4)", [
    code,
    ws.id,
    userId,
    expires
  ]);
  return { code, expires_at: expires };
};

export const describeInvite = async (code: string) => {
  const db = await getDb();
  const rows = await db.query<{ workspace_name: string; inviter: string | null; expires_at: string; used_at: string | null }>(
    `select w.name as workspace_name, u.name as inviter, i.expires_at, i.used_at
       from workspace_invites i join workspaces w on w.id = i.workspace_id
       left join users u on u.id = i.created_by
      where i.code = $1`,
    [code.toUpperCase()]
  );
  return rows[0] ?? null;
};

export const joinByCode = async (userId: string, rawCode: string) => {
  const code = rawCode.trim().toUpperCase();
  const db = await getDb();
  return db.tx(async (q) => {
    const [invite] = await q.query<{ workspace_id: string; expires_at: string; used_at: string | null }>(
      "select workspace_id, expires_at, used_at from workspace_invites where code = $1 for update",
      [code]
    );
    if (!invite) throw notFound("That invite code doesn't exist");
    if (invite.used_at) throw conflict("That invite code was already used. Ask for a new one.");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw conflict("That invite code has expired");

    const current = await getWorkspaceFor(userId, q);
    if (current?.id === invite.workspace_id) return current;
    if (current) throw conflict(`You're already in "${current.name}". Leave it first.`);

    const [{ n }] = await q.query<{ n: number }>("select count(*)::int as n from workspace_members where workspace_id = $1", [
      invite.workspace_id
    ]);
    if (n >= MAX_MEMBERS) throw conflict("That workspace is full");

    await q.query("insert into workspace_members(workspace_id, user_id, role) values ($1, $2, 'member')", [
      invite.workspace_id,
      userId
    ]);
    await q.query("update workspace_invites set used_by = $2, used_at = now() where code = $1", [code, userId]);
    return getWorkspaceFor(userId, q);
  });
};

export const leaveWorkspace = async (userId: string) => {
  const db = await getDb();
  await db.tx(async (q) => {
    const ws = await getWorkspaceFor(userId, q);
    if (!ws) return;
    await q.query("delete from workspace_members where workspace_id = $1 and user_id = $2", [ws.id, userId]);
    // Pending invitations into/out of this workspace no longer make sense.
    await q.query(
      `delete from block_participants bp using plan_blocks b
        where bp.block_id = b.id and b.workspace_id = $1 and bp.status = 'invited'
          and (bp.user_id = $2 or b.owner_id = $2)`,
      [ws.id, userId]
    );
    const remaining = ws.members.filter((m) => m.id !== userId);
    if (!remaining.length) {
      await q.query("delete from workspaces where id = $1", [ws.id]);
    } else if (!remaining.some((m) => m.role === "owner")) {
      await q.query("update workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2", [
        ws.id,
        remaining[0].id
      ]);
    }
  });
};

export const renameWorkspace = async (userId: string, name: string) => {
  const db = await getDb();
  const ws = await getWorkspaceFor(userId);
  if (!ws) throw notFound("No workspace");
  if (!ws.members.some((m) => m.id === userId && m.role === "owner")) throw forbidden("Only the owner can rename");
  await db.query("update workspaces set name = $2 where id = $1", [ws.id, name]);
  return getWorkspaceFor(userId);
};
