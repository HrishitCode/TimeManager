import { getDb } from "@/lib/server/db";
import { route } from "@/lib/server/http";

export const GET = route(async () => {
  const db = await getDb();
  const [row] = await db.query<{ now: string }>("select now() as now");
  return { ok: true, db_now: row.now, driver: process.env.DATABASE_URL ? "postgres" : "pglite" };
});
