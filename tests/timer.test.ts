import { describe, expect, it } from "vitest";
import { calculateActualDurationSec } from "@/lib/timer";

describe("calculateActualDurationSec", () => {
  it("adds elapsed seconds to existing tracked duration", () => {
    const started = "2026-02-21T10:00:00.000Z";
    const ended = "2026-02-21T10:05:00.000Z";
    expect(calculateActualDurationSec(started, ended, 30)).toBe(330);
  });
});
