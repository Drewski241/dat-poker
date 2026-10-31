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

  it("labels main+side payouts as side pots (not a chop) — K8 short vs K2 deep", () => {
    // Screenshot bd6ada89: House 7 (K8 two pair) short all-in wins main 125;
    // You (K2 one pair) take the 250 side after other stacks fold.
    expect(
      formatHandOutcomeLine({
        playerId: "you",
        winnerLabel: "House 7",
        ticker: "DAT",
        hand: {
          winnerId: "house-7",
          potMojos: "125000",
          totalPotMojos: "375000",
          isChop: false,
          reason: "showdown",
          participants: [
            {
              playerId: "you",
              stackBeforePayoutMojos: "50000",
              stackAfterMojos: "300000",
            },
            {
              playerId: "house-7",
              stackBeforePayoutMojos: "0",
              stackAfterMojos: "125000",
            },
            {
              playerId: "house-0a",
              stackBeforePayoutMojos: "1820000",
              stackAfterMojos: "1820000",
            },
          ],
        },
      }),
    ).toBe("Side pots · pot 375 DAT · you got 250 DAT · showdown");
  });
});
