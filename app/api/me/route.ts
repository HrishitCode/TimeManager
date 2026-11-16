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

const minuteOfDay = z.number().int().min(0);
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    timezone: timezone.optional(),
    day_start_min: minuteOfDay.max(1439).optional(),
    day_end_min: minuteOfDay.max(2879).optional()
  })
  .refine((b) => (b.day_start_min === undefined) === (b.day_end_min === undefined), "Send day_start_min and day_end_min together")
  .refine(
    (b) => b.day_start_min === undefined || (b.day_end_min! > b.day_start_min && b.day_end_min! - b.day_start_min <= 1440),
    "Day window must end after it starts and be at most 24 hours"
  );

export const PATCH = route(async (req): Promise<Me> => {
  const user = await requireUser(req);
  const body = await parseBody(req, patchSchema);
  const db = await getDb();
  const [updated] = await db.query<User>(
    `update users set name = coalesce($2, name), timezone = coalesce($3, timezone),
            day_start_min = coalesce($4, day_start_min), day_end_min = coalesce($5, day_end_min)
      where id = $1
     returning id, email, name, timezone, day_start_min, day_end_min`,
    [user.id, body.name ?? null, body.timezone ?? null, body.day_start_min ?? null, body.day_end_min ?? null]
  );
  return { user: updated, workspace: await getWorkspaceFor(user.id) };
});
