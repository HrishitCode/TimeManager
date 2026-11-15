import crypto from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "./db";
import { unauthorized } from "./http";
import type { User } from "@/lib/shared/types";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

export const SESSION_COOKIE = "tm_session";
const SESSION_DAYS = 60;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ───────────── passwords ─────────────
export const hashPassword = async (password: string) => {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
};

export const verifyPassword = async (password: string, stored: string) => {
  const [algo, N, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p)
  });
  return crypto.timingSafeEqual(actual, expected);
};

// ───────────── sessions ─────────────
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const createSession = async (userId: string, userAgent: string | null) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const db = await getDb();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query("insert into auth_sessions(token_hash, user_id, user_agent, expires_at) values ($1, $2, $3, $4)", [
    sha256(token),
    userId,
    userAgent?.slice(0, 300) ?? null,
    expires.toISOString()
  ]);
  return { token, expires };
};

export const setSessionCookie = (res: NextResponse, token: string, expires: Date) => {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires
  });
  return res;
};

export const clearSessionCookie = (res: NextResponse) => {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
};

/** Cookie for the web app; Bearer header for future native/CLI clients. */
const tokenFrom = (req: NextRequest) => {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
};

export const destroySession = async (req: NextRequest) => {
  const token = tokenFrom(req);
  if (!token) return;
  const db = await getDb();
  await db.query("delete from auth_sessions where token_hash = $1", [sha256(token)]);
};

export const getUser = async (req: NextRequest): Promise<User | null> => {
  const token = tokenFrom(req);
  if (!token) return null;
  const db = await getDb();
  const rows = await db.query<User>(
    `select u.id, u.email, u.name, u.timezone
       from auth_sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)]
  );
  return rows[0] ?? null;
};

export const requireUser = async (req: NextRequest): Promise<User> => {
  const user = await getUser(req);
  if (!user) throw unauthorized();
  return user;
};
