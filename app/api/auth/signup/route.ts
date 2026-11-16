import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, hashPassword, setSessionCookie } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { conflict, parseBody, route } from "@/lib/server/http";
import { timezone } from "@/lib/server/schemas";
import type { User } from "@/lib/shared/types";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(60),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  timezone: timezone.optional()
});

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const db = await getDb();
  const existing = await db.query("select 1 from users where email = $1", [body.email]);
  if (existing.length) throw conflict("An account with that email already exists");
  const [user] = await db.query<User>(
    "insert into users(email, name, password_hash, timezone) values ($1, $2, $3, $4) returning id, email, name, timezone, day_start_min, day_end_min",
    [body.email, body.name, await hashPassword(body.password), body.timezone ?? "Asia/Kolkata"]
  );
  const { token, expires } = await createSession(user.id, req.headers.get("user-agent"));
  return setSessionCookie(NextResponse.json({ user }), token, expires);
});
