import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { memberStatuses } from "@/lib/server/services/reports";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return memberStatuses(user);
});
