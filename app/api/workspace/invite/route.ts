import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { createInvite } from "@/lib/server/services/workspace";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  return createInvite(user.id);
});
