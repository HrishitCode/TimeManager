import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { badRequest, route } from "@/lib/server/http";
import { isoDate } from "@/lib/server/schemas";
import { buildReport } from "@/lib/server/services/reports";
import { dateInTz } from "@/lib/shared/time";

/** GET /api/reports?period=day|week&date=YYYY-MM-DD — you + workspace mates, side by side. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const parsed = z
    .object({ period: z.enum(["day", "week"]).default("day"), date: isoDate.optional() })
    .safeParse({
      period: req.nextUrl.searchParams.get("period") ?? undefined,
      date: req.nextUrl.searchParams.get("date") ?? undefined
    });
  if (!parsed.success) throw badRequest("period must be day|week and date YYYY-MM-DD");
  return buildReport(user, parsed.data.period, parsed.data.date ?? dateInTz(Date.now(), user.timezone));
});
