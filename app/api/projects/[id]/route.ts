import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { notFound, parseBody, route } from "@/lib/server/http";
import { color, title } from "@/lib/server/schemas";
import type { Project } from "@/lib/shared/types";

type P = { params: Promise<{ id: string }> };

const schema = z.object({ name: title.optional(), color: color.optional(), archived: z.boolean().optional() });

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const body = await parseBody(req, schema);
  const db = await getDb();
  const [p] = await db.query<Project>(
    `update projects set name = coalesce($3, name), color = coalesce($4, color),
            archived_at = case when $5::boolean is null then archived_at when $5 then coalesce(archived_at, now()) else null end
      where id = $1 and user_id = $2 returning id, name, color, archived_at`,
    [id, user.id, body.name ?? null, body.color ?? null, body.archived ?? null]
  );
  if (!p) throw notFound();
  return p;
});

/**
 * DELETE /api/projects/:id[?delete_tasks=1]
 * The project row goes. Tracked time, planned blocks and (by default) tasks are kept and become
 * "No project" via ON DELETE SET NULL, so reports' totals don't change, only the label.
 * With delete_tasks=1 the project's tasks are deleted too.
 */
export const DELETE = route<P>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const deleteTasks = req.nextUrl.searchParams.get("delete_tasks") === "1";
  const db = await getDb();
  return db.tx(async (q) => {
    const [p] = await q.query<{ id: string }>("select id from projects where id = $1 and user_id = $2 for update", [id, user.id]);
    if (!p) throw notFound();
    const tasks = deleteTasks
      ? await q.query("delete from tasks where project_id = $1 and user_id = $2 returning id", [id, user.id])
      : [];
    await q.query("delete from projects where id = $1", [id]);
    return { deleted: true, tasks_deleted: tasks.length };
  });
});
