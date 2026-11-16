import { describe, expect, it } from "vitest";
import { personalize } from "@/lib/shared/personalize";

describe("personalize", () => {
  it("rewrites the viewer's name with correct grammar", () => {
    expect(personalize("Ben worked more (6h vs 2h), but Asha was more disciplined (81 vs 0).", "Asha")).toBe(
      "Ben worked more (6h vs 2h), but you were more disciplined (81 vs 0)."
    );
    expect(personalize("Asha kept more of their plan: 90% vs Ben 50%.", "Asha")).toBe("You kept more of your plan: 90% vs Ben 50%.");
    expect(personalize("Ben kept more of their plan: 90% vs Asha 50%.", "Asha")).toBe("Ben kept more of their plan: 90% vs you 50%.");
    expect(personalize("Asha led on both: more work (5h) and more discipline (80/100).", "Asha")).toBe(
      "You led on both: more work (5h) and more discipline (80/100)."
    );
    expect(personalize("Not the same amount of time to work with: Asha 7h (9h left out) vs Ben 16h.", "Asha")).toBe(
      "Not the same amount of time to work with: You 7h (9h left out) vs Ben 16h."
    );
  });
});
