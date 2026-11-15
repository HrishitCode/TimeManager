import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { joinByCode } from "@/lib/server/services/workspace";

const schema = z.object({ code: z.string().trim().min(4).max(20) });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { code } = await parseBody(req, schema);
  return joinByCode(user.id, code);
});
