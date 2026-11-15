import fs from "node:fs";
import path from "node:path";

/**
 * Thin database layer. Everything above this file speaks plain SQL with $1-style params,
 * so the backing store is swappable:
 *   - DATABASE_URL set  → node-postgres pool (Supabase / Neon / RDS / local Postgres)
 *   - DATABASE_URL unset → PGlite (real Postgres compiled to WASM) persisted in ./.data/pglite
 */

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ───────────── type parsing (identical output for both drivers) ─────────────
const OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMPTZ: 1184, TIMESTAMP: 1114 } as const;

/** Postgres text timestamp ("2026-11-15 10:00:00.123456+05:30") → ISO-8601 UTC string. */
export const pgTimestampToIso = (value: string): string => {
  let s = value.trim().replace(" ", "T");
  s = s.replace(/(\.\d{3})\d+/, "$1");
  const m = s.match(/([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?$/);
  if (m && s.indexOf("T") < s.length - m[0].length) {
    s = s.slice(0, s.length - m[0].length) + `${m[1]}${m[2]}:${m[3] ?? "00"}`;
  } else if (!/Z$/.test(s)) {
    s += "Z";
  }
  return new Date(s).toISOString();
};

const parsers: Record<number, (v: string) => unknown> = {
  [OID.INT8]: (v) => Number(v),
  [OID.NUMERIC]: (v) => Number(v),
  [OID.DATE]: (v) => v,
  [OID.TIMESTAMPTZ]: pgTimestampToIso,
  [OID.TIMESTAMP]: pgTimestampToIso
};

// ───────────── migrations ─────────────
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

export const readMigrations = () =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));

export const migrate = async (db: Db, opts: { lock?: boolean } = {}) => {
  await db.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
  );
  const migrations = readMigrations();
  const applied = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const pending = migrations.filter((m) => !applied.has(m.name));
  if (!pending.length) return [];

  await db.tx(async (q) => {
    // Serverless cold starts can race; an advisory lock makes migration single-flight.
    if (opts.lock) await q.query("select pg_advisory_xact_lock(727274)");
    const nowApplied = new Set((await q.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
    for (const m of pending) {
      if (nowApplied.has(m.name)) continue;
      await q.query(m.sql);
      await q.query("insert into schema_migrations(name) values ($1)", [m.name]);
    }
  });
  return pending.map((m) => m.name);
};

// ───────────── drivers ─────────────
const createPgDb = async (url: string): Promise<Db> => {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  for (const [oid, fn] of Object.entries(parsers)) types.setTypeParser(Number(oid), fn);
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false }
  });
  return {
    async query(sql, params) {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({
          query: async (sql, params) => (await client.query(sql, params as unknown[])).rows
        });
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
};

export const createPgliteDb = async (dataDir?: string): Promise<Db> => {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const lite = new PGlite(dataDir, { parsers });
  await lite.waitReady;
  // PGlite is single-connection: serialise transactions so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    query: (sql, params) =>
      serial(async () => {
        if (!params?.length && sql.includes(";")) {
          await lite.exec(sql);
          return [];
        }
        return (await lite.query(sql, params as unknown[])).rows as never;
      }),
    tx: (fn) =>
      serial(() =>
        lite.transaction(async (t) =>
          fn({
            query: async (sql, params) => {
              if (!params?.length && sql.includes(";")) {
                await t.exec(sql);
                return [];
              }
              return (await t.query(sql, params as unknown[])).rows as never;
            }
          })
        )
      ),
    close: () => lite.close()
  };
};

// ───────────── singleton ─────────────
const g = globalThis as unknown as { __tmDb?: Promise<Db> };

const init = async (): Promise<Db> => {
  const url = process.env.DATABASE_URL;
  if (url) {
    const db = await createPgDb(url);
    await migrate(db, { lock: true });
    return db;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production" && !process.env.ALLOW_PGLITE) {
    throw new Error("DATABASE_URL is not set. Point it at a Postgres database (see README).");
  }
  const db = await createPgliteDb(path.join(process.cwd(), ".data", "pglite"));
  await migrate(db);
  return db;
};

export const getDb = (): Promise<Db> => {
  if (!g.__tmDb) {
    g.__tmDb = init().catch((err) => {
      g.__tmDb = undefined;
      throw err;
    });
  }
  return g.__tmDb;
};

/** Tests inject an in-memory database. */
export const setDbForTests = (db: Db | undefined) => {
  g.__tmDb = db ? Promise.resolve(db) : undefined;
};
