import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { uuid } from "@/lib/server/schemas";
import { inviteToBlock } from "@/lib/server/services/blocks";

const schema = z.object({ user_ids: z.array(uuid).min(1).max(8) });

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const { user_ids } = await parseBody(req, schema);
  return inviteToBlock(user.id, id, user_ids);
});
