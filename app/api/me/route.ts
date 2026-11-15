import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { parseBody, route } from "@/lib/server/http";
import { timezone } from "@/lib/server/schemas";
import { getWorkspaceFor } from "@/lib/server/services/workspace";
import type { Me, User } from "@/lib/shared/types";

export const GET = route(async (req): Promise<Me> => {
  const user = await requireUser(req);
  return { user, workspace: await getWorkspaceFor(user.id) };
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  timezone: timezone.optional()
});

export const PATCH = route(async (req): Promise<Me> => {
  const user = await requireUser(req);
  const body = await parseBody(req, patchSchema);
  const db = await getDb();
  const [updated] = await db.query<User>(
    `update users set name = coalesce($2, name), timezone = coalesce($3, timezone) where id = $1
     returning id, email, name, timezone`,
    [user.id, body.name ?? null, body.timezone ?? null]
  );
  return { user: updated, workspace: await getWorkspaceFor(user.id) };
});
