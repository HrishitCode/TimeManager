import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { parseBody, route } from "@/lib/server/http";
import { color, title } from "@/lib/server/schemas";
import type { Project } from "@/lib/shared/types";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  return db.query<Project>(
    "select id, name, color, archived_at from projects where user_id = $1 order by archived_at nulls first, created_at",
    [user.id]
  );
});

const schema = z.object({ name: title, color: color.optional() });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  const db = await getDb();
  const [p] = await db.query<Project>(
    "insert into projects(user_id, name, color) values ($1, $2, coalesce($3, '#3b6fd8')) returning id, name, color, archived_at",
    [user.id, body.name, body.color ?? null]
  );
  return p;
});
