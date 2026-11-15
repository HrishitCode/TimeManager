import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { isoInstant, optUuid } from "@/lib/server/schemas";
import { getTimer, pauseTimer, resumeTimer, startTimer, stopTimer } from "@/lib/server/services/timer";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return { timer: await getTimer(user.id), server_now: new Date().toISOString() };
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    project_id: optUuid,
    task_id: optUuid,
    block_id: optUuid,
    label: z.string().trim().max(200).nullable().optional(),
    mode: z.enum(["focus", "break"]).optional(),
    planned_sec: z.number().int().positive().max(16 * 3600).nullable().optional()
  }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("stop"), at: isoInstant.optional() })
]);

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  let timer;
  switch (body.action) {
    case "start": {
      const { project_id, task_id, block_id, label, mode, planned_sec } = body;
      const input = { project_id, task_id, block_id, label, mode, planned_sec };
      timer = await startTimer(user.id, input);
      break;
    }
    case "pause":
      timer = await pauseTimer(user.id);
      break;
    case "resume":
      timer = await resumeTimer(user.id);
      break;
    case "stop":
      timer = await stopTimer(user.id, body.at);
      break;
  }
  return { timer, server_now: new Date().toISOString() };
});
