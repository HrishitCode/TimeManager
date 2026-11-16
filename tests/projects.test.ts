import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Db } from "@/lib/server/db";
import { createSession } from "@/lib/server/auth";
import { DELETE as deleteProject } from "@/app/api/projects/[id]/route";
import { freshDb, ist, makeUser } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

const call = async (cookie: string, id: string, qs = "") =>
  deleteProject(new NextRequest(`http://localhost/api/projects/${id}${qs}`, { method: "DELETE", headers: { cookie } }), {
    params: Promise.resolve({ id })
  });

describe("DELETE /api/projects/:id", () => {
  it("deletes the project but keeps tasks, blocks and tracked time as 'No project'", async () => {
    const a = await makeUser(db, "Asha");
    const { token } = await createSession(a.id, null);
    const cookie = `tm_session=${token}`;
    const [p] = await db.query<{ id: string }>("insert into projects(user_id, name) values ($1, 'Office') returning id", [a.id]);
    await db.query("insert into tasks(user_id, project_id, title) values ($1, $2, 'Standup notes')", [a.id, p.id]);
    await db.query("insert into time_entries(user_id, project_id, started_at, ended_at) values ($1, $2, $3, $4)", [
      a.id,
      p.id,
      ist("2026-11-09", "09:00"),
      ist("2026-11-09", "10:00")
    ]);

    const res = await call(cookie, p.id);
    expect(await res.json()).toEqual({ deleted: true, tasks_deleted: 0 });
    expect(await db.query("select project_id from tasks where user_id = $1", [a.id])).toEqual([{ project_id: null }]);
    expect(await db.query("select project_id from time_entries where user_id = $1", [a.id])).toEqual([{ project_id: null }]);
  });

  it("optionally deletes its tasks, and refuses other users' projects", async () => {
    const a = await makeUser(db, "Asha");
    const b = await makeUser(db, "Ben");
    const [p] = await db.query<{ id: string }>("insert into projects(user_id, name) values ($1, 'Office') returning id", [a.id]);
    await db.query("insert into tasks(user_id, project_id, title) values ($1, $2, 't1'), ($1, $2, 't2'), ($1, null, 'keep')", [a.id, p.id]);

    const ben = await createSession(b.id, null);
    expect((await call(`tm_session=${ben.token}`, p.id)).status).toBe(404);

    const asha = await createSession(a.id, null);
    const res = await call(`tm_session=${asha.token}`, p.id, "?delete_tasks=1");
    expect(await res.json()).toEqual({ deleted: true, tasks_deleted: 2 });
    expect((await db.query<{ title: string }>("select title from tasks")).map((t) => t.title)).toEqual(["keep"]);
  });
});
