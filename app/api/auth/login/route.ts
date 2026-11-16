import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { HttpError, parseBody, route } from "@/lib/server/http";
import type { User } from "@/lib/shared/types";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
});

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const db = await getDb();
  const [row] = await db.query<User & { password_hash: string }>(
    "select id, email, name, timezone, day_start_min, day_end_min, password_hash from users where email = $1",
    [body.email]
  );
  if (!row || !(await verifyPassword(body.password, row.password_hash))) {
    throw new HttpError(401, "Wrong email or password");
  }
  const { token, expires } = await createSession(row.id, req.headers.get("user-agent"));
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    timezone: row.timezone,
    day_start_min: row.day_start_min,
    day_end_min: row.day_end_min
  };
  return setSessionCookie(NextResponse.json({ user }), token, expires);
});
