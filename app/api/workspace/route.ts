import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { createWorkspace, leaveWorkspace, renameWorkspace } from "@/lib/server/services/workspace";

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { name } = await parseBody(req, nameSchema);
  return createWorkspace(user.id, name);
});

export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  const { name } = await parseBody(req, nameSchema);
  return renameWorkspace(user.id, name);
});

/** Leave the workspace (deletes it if you were the last member). */
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  await leaveWorkspace(user.id);
  return { ok: true };
});
