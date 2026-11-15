import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { deleteEntry } from "@/lib/server/services/timer";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await deleteEntry(user.id, id);
  return { ok: true };
});
