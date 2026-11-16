import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { badRequest, parseBody, route } from "@/lib/server/http";
import { isoInstant, optUuid, title, uuid } from "@/lib/server/schemas";
import { createBlock, listBlocks } from "@/lib/server/services/blocks";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const range = z.object({ from: isoInstant, to: isoInstant }).safeParse({ from, to });
  if (!range.success) throw badRequest("from and to (ISO timestamps) are required");
  if (new Date(range.data.to).getTime() - new Date(range.data.from).getTime() > 45 * 86_400_000) {
    throw badRequest("Range too large (max 45 days)");
  }
  return listBlocks(user.id, range.data.from, range.data.to);
});

const schema = z.object({
  title,
  starts_at: isoInstant,
  ends_at: isoInstant,
  project_id: optUuid,
  task_id: optUuid,
  include_in_reports: z.boolean().optional(),
  invite_user_ids: z.array(uuid).max(8).optional()
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  return createBlock(user.id, await parseBody(req, schema));
});
