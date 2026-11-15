import { createPgliteDb, migrate, setDbForTests, type Db } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/auth";
import type { User } from "@/lib/shared/types";

export const freshDb = async (): Promise<Db> => {
  const db = await createPgliteDb(); // in-memory
  await migrate(db);
  setDbForTests(db);
  return db;
};

export const makeUser = async (db: Db, name: string, timezone = "Asia/Kolkata"): Promise<User> => {
  const [u] = await db.query<User>(
    "insert into users(email, name, password_hash, timezone) values ($1, $2, $3, $4) returning id, email, name, timezone",
    [`${name.toLowerCase()}@example.com`, name, await hashPassword("password123"), timezone]
  );
  return u;
};

/** IST wall-clock → ISO instant. */
export const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
