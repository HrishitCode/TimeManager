import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Db } from "@/lib/server/db";
import { freshDb, ist, makeUser } from "./helpers";
import { createInvite, createWorkspace, getWorkspaceFor, joinByCode, leaveWorkspace } from "@/lib/server/services/workspace";
import { createBlock, listBlocks, respondToBlock, updateBlock, copyDay } from "@/lib/server/services/blocks";
import { getTimer, pauseTimer, resumeTimer, setEntryInclude, setTimerInclude, startTimer, stopTimer, listEntries } from "@/lib/server/services/timer";
import { buildReport, memberStatuses } from "@/lib/server/services/reports";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/me/route";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

const D = "2026-11-09";

const pair = async () => {
  const a = await makeUser(db, "Asha");
  const b = await makeUser(db, "Ben");
  await createWorkspace(a.id, "Study buddies");
  const { code } = await createInvite(a.id);
  await joinByCode(b.id, code);
  return { a, b };
};

describe("workspaces", () => {
  it("creates, invites, joins, and enforces single-use codes", async () => {
    const { a, b } = await pair();
    const ws = await getWorkspaceFor(a.id);
    expect(ws?.members.map((m) => [m.name, m.role])).toEqual([
      ["Asha", "owner"],
      ["Ben", "member"]
    ]);
    const c = await makeUser(db, "Cara");
    const { code } = await createInvite(b.id);
    await joinByCode(c.id, code);
    const d = await makeUser(db, "Dev");
    await expect(joinByCode(d.id, code)).rejects.toThrow(/already used/);
  });

  it("hands ownership over when the owner leaves", async () => {
    const { a, b } = await pair();
    await leaveWorkspace(a.id);
    expect(await getWorkspaceFor(a.id)).toBeNull();
    expect((await getWorkspaceFor(b.id))?.members).toEqual([expect.objectContaining({ name: "Ben", role: "owner" })]);
  });
});

describe("blocks & shared sessions", () => {
  it("syncs calendars and handles invitations", async () => {
    const { a, b } = await pair();
    await createBlock(b.id, { title: "Ben solo", starts_at: ist(D, "07:00"), ends_at: ist(D, "08:00") });
    const joint = await createBlock(a.id, {
      title: "Graphs together",
      starts_at: ist(D, "20:00"),
      ends_at: ist(D, "21:00"),
      invite_user_ids: [b.id]
    });
    expect(joint?.participants.map((p) => p.status)).toEqual(["accepted", "invited"]);

    const range = [ist(D, "00:00"), ist("2026-11-10", "00:00")] as const;
    const aView = await listBlocks(a.id, ...range);
    expect(aView.map((x) => x.title)).toEqual(["Ben solo", "Graphs together"]); // partner's calendar is visible

    // Ben has a clash → accepting fails; after moving his block it works.
    const clash = await createBlock(b.id, { title: "Gym", starts_at: ist(D, "20:30"), ends_at: ist(D, "21:30") });
    await expect(respondToBlock(b.id, joint!.id, "accepted")).rejects.toThrow(/Gym/);
    await updateBlock(b.id, clash!.id, { starts_at: ist(D, "21:00"), ends_at: ist(D, "22:00") });
    const accepted = await respondToBlock(b.id, joint!.id, "accepted");
    expect(accepted?.participants.every((p) => p.status === "accepted")).toBe(true);

    // Organiser can't now move the session onto Ben's gym slot.
    await expect(updateBlock(a.id, joint!.id, { ends_at: ist(D, "21:30") })).rejects.toThrow(/Ben's "Gym"/);
    // Overlap with own block is rejected.
    await expect(createBlock(a.id, { title: "x", starts_at: ist(D, "20:15"), ends_at: ist(D, "20:45") })).rejects.toThrow(/Overlaps/);
  });

  it("copies a day's plan", async () => {
    const a = await makeUser(db, "Asha");
    await createBlock(a.id, { title: "Deep work", starts_at: ist(D, "09:00"), ends_at: ist(D, "11:00") });
    await createBlock(a.id, { title: "Reading", starts_at: ist(D, "21:00"), ends_at: ist(D, "22:00") });
    const res = await copyDay(a.id, ist(D, "00:00"), ist("2026-11-10", "00:00"), 86_400_000);
    expect(res).toEqual({ copied: 2, skipped: 0 });
    const again = await copyDay(a.id, ist(D, "00:00"), ist("2026-11-10", "00:00"), 86_400_000);
    expect(again).toEqual({ copied: 0, skipped: 2 });
  });
});

describe("timer", () => {
  it("records each running segment as an entry", async () => {
    const a = await makeUser(db, "Asha");
    const t = await startTimer(a.id, { label: "Reading", planned_sec: 1500 });
    expect(t.status).toBe("running");
    // Rewind the segment so it has measurable length.
    await db.query("update timers set segment_started_at = now() - interval '10 minutes', session_started_at = now() - interval '10 minutes' where user_id = $1", [a.id]);
    const paused = await pauseTimer(a.id);
    expect(paused?.status).toBe("paused");
    expect(paused?.accumulated_sec).toBeGreaterThanOrEqual(600);
    expect(await pauseTimer(a.id)).toMatchObject({ status: "paused" }); // idempotent
    await resumeTimer(a.id);
    await db.query("update timers set segment_started_at = now() - interval '5 minutes' where user_id = $1", [a.id]);
    await stopTimer(a.id);
    expect(await getTimer(a.id)).toBeNull();
    const entries = await listEntries(a.id, new Date(Date.now() - 3_600_000).toISOString(), new Date().toISOString());
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.label === "Reading")).toBe(true);
  });

  it("lets you stop a forgotten timer at the real time", async () => {
    const a = await makeUser(db, "Asha");
    await startTimer(a.id, {});
    await db.query("update timers set segment_started_at = now() - interval '20 hours' where user_id = $1", [a.id]);
    await expect(stopTimer(a.id)).rejects.toThrow(/actually stopped/);
    const at = new Date(Date.now() - 19 * 3_600_000).toISOString();
    await stopTimer(a.id, at);
    const [e] = await listEntries(a.id, new Date(Date.now() - 86_400_000).toISOString(), new Date().toISOString());
    expect(new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()).toBeCloseTo(3_600_000, -4);
  });
});

describe("reports", () => {
  it("compares both members for a day", async () => {
    const { a, b } = await pair();
    const joint = await createBlock(a.id, { title: "Together", starts_at: ist(D, "20:00"), ends_at: ist(D, "21:00"), invite_user_ids: [b.id] });
    await respondToBlock(b.id, joint!.id, "accepted");
    await db.query(
      "insert into time_entries(user_id, started_at, ended_at) values ($1, $2, $3), ($4, $5, $6)",
      [a.id, ist(D, "20:00"), ist(D, "21:00"), b.id, ist(D, "20:20"), ist(D, "21:00")]
    );
    const report = await buildReport(b, "day", D);
    expect(report.members.map((m) => m.name)).toEqual(["Ben", "Asha"]); // viewer first
    expect(report.joint_sessions[0].members.map((m) => m.attended_min)).toEqual([60, 40]);
    expect(report.verdicts.find((v) => v.metric === "Plan adherence")?.winner_id).toBe(a.id);

    const week = await buildReport(a, "week", D);
    expect(week.start_date).toBe("2026-11-09");
    expect(week.members[0].series).toHaveLength(7);
  });

  it("shows live status of workspace mates", async () => {
    const { a, b } = await pair();
    await startTimer(b.id, { label: "Leetcode" });
    const statuses = await memberStatuses(a);
    expect(statuses.find((s) => s.user_id === b.id)?.timer?.label).toBe("Leetcode");
  });
});

describe("report opt-out (services)", () => {
  it("excluded blocks and timers flow through to the report", async () => {
    const a = await makeUser(db, "Asha");
    const office = await createBlock(a.id, { title: "Office", starts_at: ist(D, "09:00"), ends_at: ist(D, "18:00"), include_in_reports: false });
    expect(office?.include_in_reports).toBe(false);
    await createBlock(a.id, { title: "DSA", starts_at: ist(D, "19:00"), ends_at: ist(D, "20:00") });
    await db.query(
      "insert into time_entries(user_id, started_at, ended_at) values ($1, $2, $3), ($1, $4, $5)",
      [a.id, ist(D, "10:00"), ist(D, "17:00"), ist(D, "19:00"), ist(D, "19:45")]
    );
    const [me] = (await buildReport(a, "day", D)).members;
    expect(me.excluded_min).toBe(540);
    expect(me.focus_min).toBe(45);
    expect(me.adherence_pct).toBe(75);

    // Re-including the block brings it back.
    await updateBlock(a.id, office!.id, { include_in_reports: true });
    const [again] = (await buildReport(a, "day", D)).members;
    expect(again.excluded_min).toBe(0);
    expect(again.focus_min).toBe(465);
  });

  it("timer inherits the block's setting, can be flipped, and stamps its entries", async () => {
    const a = await makeUser(db, "Asha");
    const now = Date.now();
    const office = await createBlock(a.id, {
      title: "Office",
      starts_at: new Date(now - 3_600_000).toISOString(),
      ends_at: new Date(now + 3_600_000).toISOString(),
      include_in_reports: false
    });
    const t = await startTimer(a.id, { block_id: office!.id });
    expect(t.include_in_reports).toBe(false);
    await db.query("update timers set segment_started_at = now() - interval '5 minutes' where user_id = $1", [a.id]);
    await pauseTimer(a.id);
    expect((await setTimerInclude(a.id, true))?.include_in_reports).toBe(true);
    await resumeTimer(a.id);
    await db.query("update timers set segment_started_at = now() - interval '5 minutes' where user_id = $1", [a.id]);
    await stopTimer(a.id);
    const entries = await listEntries(a.id, new Date(now - 3_600_000).toISOString(), new Date(now + 60_000).toISOString());
    expect(entries.map((e) => e.include_in_reports)).toEqual([false, true]);

    const flipped = await setEntryInclude(a.id, entries[0].id, true);
    expect(flipped.include_in_reports).toBe(true);
  });
});

describe("auth routes", () => {
  const req = (url: string, init?: { method?: string; body?: unknown; cookie?: string }) =>
    new NextRequest(`http://localhost${url}`, {
      method: init?.method ?? "GET",
      body: init?.body ? JSON.stringify(init.body) : undefined,
      headers: { "content-type": "application/json", ...(init?.cookie ? { cookie: init.cookie } : {}) }
    });
  const ctx = { params: Promise.resolve({}) };

  it("signs up, logs in and authenticates with the cookie", async () => {
    const res = await signup(req("/api/auth/signup", { method: "POST", body: { email: "Me@X.com", name: "Me", password: "longpassword" } }), ctx);
    expect(res.status).toBe(200);
    const dup = await signup(req("/api/auth/signup", { method: "POST", body: { email: "me@x.com", name: "Me", password: "longpassword" } }), ctx);
    expect(dup.status).toBe(409);

    const bad = await login(req("/api/auth/login", { method: "POST", body: { email: "me@x.com", password: "nope" } }), ctx);
    expect(bad.status).toBe(401);
    const ok = await login(req("/api/auth/login", { method: "POST", body: { email: "me@x.com", password: "longpassword" } }), ctx);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect(cookie).toMatch(/^tm_session=/);

    const meRes = await me(req("/api/me", { cookie }), ctx);
    expect(await meRes.json()).toMatchObject({ user: { email: "me@x.com" }, workspace: null });
    expect((await me(req("/api/me"), ctx)).status).toBe(401);
  });
});
