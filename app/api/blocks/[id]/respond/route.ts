import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { respondToBlock } from "@/lib/server/services/blocks";

const schema = z.object({ status: z.enum(["accepted", "declined"]) });

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const { status } = await parseBody(req, schema);
  return respondToBlock(user.id, id, status);
});
