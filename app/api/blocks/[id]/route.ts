import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { isoInstant, optUuid, title } from "@/lib/server/schemas";
import { deleteBlock, updateBlock } from "@/lib/server/services/blocks";

type P = { params: Promise<{ id: string }> };

const schema = z.object({
  title: title.optional(),
  starts_at: isoInstant.optional(),
  ends_at: isoInstant.optional(),
  project_id: optUuid,
  task_id: optUuid
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const body = await parseBody(req, schema);
  const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  return updateBlock(user.id, id, patch);
});

export const DELETE = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  return deleteBlock(user.id, id);
});
