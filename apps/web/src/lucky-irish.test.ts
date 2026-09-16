import { describe, expect, it } from "vitest";
import { isLuckyIrishWin, LUCKY_IRISH_POT_BB } from "./lucky-irish.js";
import type { HandResult } from "./api.js";

const bb = 10_000n;

function result(partial: Partial<HandResult> & Pick<HandResult, "winnerId" | "potMojos">): HandResult {
  return {
    handId: "h1",
    reason: "showdown",
    ...partial,
  };
}

describe("isLuckyIrishWin", () => {
  it("fires when you win a showdown full house even on a small pot", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "you",
          potMojos: "15000",
          shown: [{ playerId: "you", holeCards: [], category: "full_house" }],
        }),
      }),
    ).toBe(true);
  });

  it("fires when you win a pot of 20 big blinds or more", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "you",
          potMojos: (bb * LUCKY_IRISH_POT_BB).toString(),
          reason: "fold",
        }),
      }),
    ).toBe(true);
  });

  it("does not fire when the house wins a full house", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "dat-poker:house",
          potMojos: "80000",
          shown: [{ playerId: "dat-poker:house", holeCards: [], category: "full_house" }],
        }),
      }),
    ).toBe(false);
  });

  it("does not fire for a small-pot pair", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "you",
          potMojos: "15000",
          shown: [{ playerId: "you", holeCards: [], category: "pair" }],
        }),
      }),
    ).toBe(false);
  });
});
