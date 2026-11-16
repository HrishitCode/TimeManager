import { describe, expect, it } from "vitest";
import { addDays, dateInTz, dayRange, intersect, mergeIntervals, subtract, tzOffsetMinutes, weekStart, zonedMidnight } from "@/lib/shared/time";
import { pgTimestampToIso } from "@/lib/server/db";

describe("time zones", () => {
  it("knows IST and DST offsets", () => {
    expect(tzOffsetMinutes(Date.UTC(2026, 0, 1), "Asia/Kolkata")).toBe(330);
    expect(tzOffsetMinutes(Date.UTC(2026, 0, 15), "America/New_York")).toBe(-300);
    expect(tzOffsetMinutes(Date.UTC(2026, 6, 15), "America/New_York")).toBe(-240);
  });

  it("finds local midnight", () => {
    expect(new Date(zonedMidnight("2026-11-15", "Asia/Kolkata")).toISOString()).toBe("2026-11-14T18:30:00.000Z");
    // DST start day in New York is 23h long.
    const r = dayRange("2026-03-08", "America/New_York");
    expect((r.endMs - r.startMs) / 3_600_000).toBe(23);
  });

  it("maps instants to local dates", () => {
    expect(dateInTz("2026-11-14T19:00:00Z", "Asia/Kolkata")).toBe("2026-11-15");
    expect(dateInTz("2026-11-14T18:00:00Z", "Asia/Kolkata")).toBe("2026-11-14");
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday → previous Monday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
  });
});

describe("intervals", () => {
  it("merges and intersects", () => {
    expect(mergeIntervals([{ start: 5, end: 10 }, { start: 0, end: 6 }, { start: 20, end: 30 }])).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 }
    ]);
    expect(intersect([{ start: 0, end: 10 }, { start: 20, end: 30 }], [{ start: 5, end: 25 }])).toEqual([
      { start: 5, end: 10 },
      { start: 20, end: 25 }
    ]);
  });
});

describe("subtract", () => {
  it("cuts holes out of interval sets", () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 10, end: 20 }, { start: 50, end: 60 }])).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 50 },
      { start: 60, end: 100 }
    ]);
    expect(subtract([{ start: 0, end: 10 }], [{ start: -5, end: 15 }])).toEqual([]);
    expect(subtract([{ start: 0, end: 10 }, { start: 20, end: 30 }], [{ start: 5, end: 25 }])).toEqual([
      { start: 0, end: 5 },
      { start: 25, end: 30 }
    ]);
    expect(subtract([{ start: 0, end: 10 }], [])).toEqual([{ start: 0, end: 10 }]);
  });
});

describe("PGlite rows match node-postgres", () => {
  it("returns ISO strings, plain dates and numbers", async () => {
    const { createPgliteDb } = await import("@/lib/server/db");
    const db = await createPgliteDb();
    const [row] = await db.query<Record<string, unknown>>(
      "select '2026-11-15 10:00:00+05:30'::timestamptz as ts, '2026-11-15'::date as d, count(*) as n, null::timestamptz as z from (values (1),(2)) v"
    );
    expect(row).toEqual({ ts: "2026-11-15T04:30:00.000Z", d: "2026-11-15", n: 2, z: null });
    const [inTx] = await db.tx((q) => q.query<{ ts: unknown }>("select now() as ts"));
    expect(typeof inTx.ts).toBe("string");
    await db.close();
  });
});

describe("pg timestamp parsing", () => {
  it("normalises driver output", () => {
    expect(pgTimestampToIso("2026-11-15 10:00:00+00")).toBe("2026-11-15T10:00:00.000Z");
    expect(pgTimestampToIso("2026-11-15 10:00:00.123456+05:30")).toBe("2026-11-15T04:30:00.123Z");
    expect(pgTimestampToIso("2026-11-15 10:00:00")).toBe("2026-11-15T10:00:00.000Z");
  });
});
