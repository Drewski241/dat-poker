import { describe, expect, it } from "vitest";
import { formatHandOutcomeLine } from "./hand-outcome-line.js";

describe("formatHandOutcomeLine", () => {
  it("labels a split pot as a chop instead of a solo win of half the pot", () => {
    expect(
      formatHandOutcomeLine({
        playerId: "you",
        winnerLabel: "You",
        ticker: "DAT",
        hand: {
          winnerId: "you",
          potMojos: "4920",
          totalPotMojos: "9840",
          isChop: true,
          reason: "showdown",
          participants: [
            {
              playerId: "you",
              stackBeforePayoutMojos: "0",
              stackAfterMojos: "4920",
            },
            {
              playerId: "house",
              stackBeforePayoutMojos: "4160",
              stackAfterMojos: "9080",
            },
          ],
        },
      }),
    ).toBe("Chop · pot 9.84 DAT · you got 4.92 DAT · showdown");
  });

  it("keeps sole-win wording when only one player is awarded", () => {
    expect(
      formatHandOutcomeLine({
        playerId: "you",
        winnerLabel: "You",
        ticker: "DAT",
        hand: {
          winnerId: "you",
          potMojos: "9840",
          totalPotMojos: "9840",
          isChop: false,
          reason: "showdown",
          participants: [
            {
              playerId: "you",
              stackBeforePayoutMojos: "0",
              stackAfterMojos: "9840",
            },
            {
              playerId: "house",
              stackBeforePayoutMojos: "4160",
              stackAfterMojos: "4160",
            },
          ],
        },
      }),
    ).toBe("You won 9.84 DAT · showdown");
  });
});
