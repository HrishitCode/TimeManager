import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession } from "@/lib/server/auth";
import { route } from "@/lib/server/http";

export const POST = route(async (req) => {
  await destroySession(req);
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
