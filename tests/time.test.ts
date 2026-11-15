import { describe, expect, it } from "vitest";
import { addDays, dateInTz, dayRange, intersect, mergeIntervals, tzOffsetMinutes, weekStart, zonedMidnight } from "@/lib/shared/time";
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

describe("pg timestamp parsing", () => {
  it("normalises driver output", () => {
    expect(pgTimestampToIso("2026-11-15 10:00:00+00")).toBe("2026-11-15T10:00:00.000Z");
    expect(pgTimestampToIso("2026-11-15 10:00:00.123456+05:30")).toBe("2026-11-15T04:30:00.123Z");
    expect(pgTimestampToIso("2026-11-15 10:00:00")).toBe("2026-11-15T10:00:00.000Z");
  });
});
