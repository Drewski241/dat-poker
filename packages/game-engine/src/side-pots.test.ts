import { describe, expect, it } from "vitest";
import { buildSidePots, splitPotEvenly } from "./side-pots.js";

describe("buildSidePots", () => {
  it("splits a short all-in from a deeper stack", () => {
    const pots = buildSidePots([
      { playerId: "short", totalBetHandMojos: 1000n },
      { playerId: "deep", totalBetHandMojos: 2000n },
    ]);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({
      amountMojos: 2000n,
      eligiblePlayerIds: ["short", "deep"],
    });
    expect(pots[1]).toEqual({
      amountMojos: 1000n,
      eligiblePlayerIds: ["deep"],
    });
  });

  it("keeps three stack layers for a deep shove covering mid and short", () => {
    const pots = buildSidePots([
      { playerId: "short", totalBetHandMojos: 1000n },
      { playerId: "mid", totalBetHandMojos: 3000n },
      { playerId: "deep", totalBetHandMojos: 3000n }, // after uncalled refund above mid
    ]);
    expect(pots).toEqual([
      { amountMojos: 3000n, eligiblePlayerIds: ["short", "mid", "deep"] },
      { amountMojos: 4000n, eligiblePlayerIds: ["mid", "deep"] },
    ]);
  });
});

describe("splitPotEvenly", () => {
  it("splits odd chips to low indices first", () => {
    expect(splitPotEvenly(100n, 3)).toEqual([34n, 33n, 33n]);
  });
});
