import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { isoInstant } from "@/lib/server/schemas";
import { copyDay } from "@/lib/server/services/blocks";

// The client sends local-midnight instants for both days, so DST and time zones stay the browser's concern.
const schema = z.object({ from_start: isoInstant, from_end: isoInstant, to_start: isoInstant });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  const shift = new Date(body.to_start).getTime() - new Date(body.from_start).getTime();
  return copyDay(user.id, body.from_start, body.from_end, shift);
});
