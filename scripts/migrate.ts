// npm run db:migrate — apply pending SQL migrations to DATABASE_URL (or local PGlite).
import { getDb, migrate } from "../lib/server/db";

const main = async () => {
  const db = await getDb(); // getDb() already migrates; run again to print status
  const applied = await migrate(db, { lock: Boolean(process.env.DATABASE_URL) });
  const rows = await db.query<{ name: string; applied_at: string }>("select name, applied_at from schema_migrations order by name");
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date.");
  rows.forEach((r) => console.log(`  ✓ ${r.name}  (${r.applied_at})`));
  await db.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
