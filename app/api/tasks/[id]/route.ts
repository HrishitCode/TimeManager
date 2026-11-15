import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { notFound, parseBody, route } from "@/lib/server/http";
import { isoDate, optUuid, title } from "@/lib/server/schemas";
import type { Task } from "@/lib/shared/types";

const COLS = "id, project_id, title, notes, status, due_date, estimate_min, completed_at, created_at";

const schema = z.object({
  title: title.optional(),
  project_id: optUuid,
  notes: z.string().max(2000).nullable().optional(),
  due_date: isoDate.nullable().optional(),
  estimate_min: z.number().int().positive().max(24 * 60).nullable().optional(),
  status: z.enum(["todo", "done"]).optional()
});

type P = { params: Promise<{ id: string }> };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const body = await parseBody(req, schema);
  const db = await getDb();
  const [current] = await db.query<Task>(`select ${COLS} from tasks where id = $1 and user_id = $2`, [id, user.id]);
  if (!current) throw notFound();
  const next = { ...current, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as Task;
  const completedAt =
    next.status === "done" ? current.completed_at ?? new Date().toISOString() : null;
  const [t] = await db.query<Task>(
    `update tasks set title = $3, project_id = $4, notes = $5, due_date = $6, estimate_min = $7, status = $8, completed_at = $9
      where id = $1 and user_id = $2 returning ${COLS}`,
    [id, user.id, next.title, next.project_id, next.notes, next.due_date, next.estimate_min, next.status, completedAt]
  );
  return t;
});

export const DELETE = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const db = await getDb();
  await db.query("delete from tasks where id = $1 and user_id = $2", [id, user.id]);
  return { ok: true };
});
