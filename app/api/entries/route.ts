import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { badRequest, forbidden, parseBody, route } from "@/lib/server/http";
import { isoInstant, optUuid, uuid } from "@/lib/server/schemas";
import { addManualEntry, listEntries } from "@/lib/server/services/timer";
import { visibleUserIds } from "@/lib/server/services/workspace";

/** GET /api/entries?from&to[&user_id] — your tracked time, or a workspace mate's (shared for accountability). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const sp = req.nextUrl.searchParams;
  const parsed = z
    .object({ from: isoInstant, to: isoInstant, user_id: uuid.optional() })
    .safeParse({ from: sp.get("from"), to: sp.get("to"), user_id: sp.get("user_id") ?? undefined });
  if (!parsed.success) throw badRequest("from and to (ISO timestamps) are required");
  const target = parsed.data.user_id ?? user.id;
  if (target !== user.id && !(await visibleUserIds(user.id)).includes(target)) throw forbidden();
  return listEntries(target, parsed.data.from, parsed.data.to);
});

const schema = z.object({
  started_at: isoInstant,
  ended_at: isoInstant,
  project_id: optUuid,
  task_id: optUuid,
  label: z.string().trim().max(200).nullable().optional(),
  mode: z.enum(["focus", "break"]).optional()
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  return addManualEntry(user.id, await parseBody(req, schema));
});
