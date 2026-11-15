import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { badRequest, parseBody, route } from "@/lib/server/http";
import { isoDate, optUuid, title } from "@/lib/server/schemas";
import type { Task } from "@/lib/shared/types";

const TASK_COLUMNS = "id, project_id, title, notes, status, due_date, estimate_min, completed_at, created_at";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  // Open tasks + anything finished in the last 14 days.
  return db.query<Task>(
    `select ${TASK_COLUMNS} from tasks
      where user_id = $1 and (status = 'todo' or completed_at > now() - interval '14 days')
      order by status desc, due_date nulls last, created_at`,
    [user.id]
  );
});

const schema = z.object({
  title,
  project_id: optUuid,
  notes: z.string().max(2000).nullable().optional(),
  due_date: isoDate.nullable().optional(),
  estimate_min: z.number().int().positive().max(24 * 60).nullable().optional()
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  const db = await getDb();
  if (body.project_id) {
    const ok = await db.query("select 1 from projects where id = $1 and user_id = $2", [body.project_id, user.id]);
    if (!ok.length) throw badRequest("Unknown project");
  }
  const [t] = await db.query<Task>(
    `insert into tasks(user_id, project_id, title, notes, due_date, estimate_min)
     values ($1, $2, $3, $4, $5, $6) returning ${TASK_COLUMNS}`,
    [user.id, body.project_id ?? null, body.title, body.notes ?? null, body.due_date ?? null, body.estimate_min ?? null]
  );
  return t;
});
