import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { notFound, parseBody, route } from "@/lib/server/http";
import { color, title } from "@/lib/server/schemas";
import type { Project } from "@/lib/shared/types";

const schema = z.object({ name: title.optional(), color: color.optional(), archived: z.boolean().optional() });

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
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
