import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { deleteEntry, setEntryInclude } from "@/lib/server/services/timer";

type P = { params: Promise<{ id: string }> };

/** PATCH { include_in_reports } — opt a tracked entry in/out of reports. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const { include_in_reports } = await parseBody(req, z.object({ include_in_reports: z.boolean() }));
  return setEntryInclude(user.id, id, include_in_reports);
});

export const DELETE = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await deleteEntry(user.id, id);
  return { ok: true };
});
