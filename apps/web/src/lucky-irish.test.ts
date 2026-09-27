import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLuckyIrishWin,
  LUCKY_IRISH_POT_BB,
  pickBigWinOverlay,
} from "./lucky-irish.js";
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

  it("fires when you win a pot of 100 big blinds or more", () => {
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

  it("does not fire for a routine 50 big blind pot with a pair", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "you",
          potMojos: (bb * 50n).toString(),
          reason: "showdown",
          shown: [{ playerId: "you", holeCards: [], category: "pair" }],
        }),
      }),
    ).toBe(false);
  });

  it("does not treat fold wins as high-ranking hands", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "you",
          potMojos: "15000",
          reason: "fold",
          shown: [{ playerId: "you", holeCards: [], category: "full_house" }],
        }),
      }),
    ).toBe(false);
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

describe("pickBigWinOverlay", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  it("alternates hunter and irish after the first pick", () => {
    expect(pickBigWinOverlay("irish")).toBe("hunter");
    expect(pickBigWinOverlay("hunter")).toBe("irish");
  });

  it("starts with irish when there is no prior overlay", () => {
    expect(pickBigWinOverlay(null)).toBe("irish");
    expect(pickBigWinOverlay(null)).toBe("hunter");
  });
});
