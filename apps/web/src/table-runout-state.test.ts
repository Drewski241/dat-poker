import { describe, expect, it } from "vitest";
import { isRunoutCinemaActive, shouldClearOrphanRunout } from "./table-runout-state.js";

describe("table runout state", () => {
  it("treats runout as active only with a hand result", () => {
    expect(isRunoutCinemaActive(3, { handId: "h1" } as never)).toBe(true);
    expect(isRunoutCinemaActive(3, null)).toBe(false);
  });

  it("clears orphan runout flags after relocation or refresh", () => {
    expect(shouldClearOrphanRunout(3, null, null)).toBe(true);
    expect(shouldClearOrphanRunout(null, null, null)).toBe(false);
    expect(shouldClearOrphanRunout(3, { handId: "h1" } as never, null)).toBe(false);
  });
});
