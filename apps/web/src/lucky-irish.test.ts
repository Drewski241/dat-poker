import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BIG_WIN_CYCLE,
  isLuckyIrishWin,
  LUCKY_IRISH_POT_BB,
  parseBigWinPreviewHash,
  pickBigWinOverlay,
  shouldDeferBigWinForRunout,
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

  it("fires when you win a contested all-in pot of 100 big blinds or more", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "you",
          potMojos: (bb * LUCKY_IRISH_POT_BB).toString(),
          reason: "showdown",
          allInPlayerIds: ["you"],
          runoutFromBoardLen: 0,
        }),
      }),
    ).toBe(true);
  });

  it("does not fire when you shove and nobody calls (fold win)", () => {
    expect(
      isLuckyIrishWin({
        playerId: "you",
        bigBlindMojos: bb,
        result: result({
          winnerId: "you",
          potMojos: (bb * LUCKY_IRISH_POT_BB).toString(),
          reason: "fold",
          allInPlayerIds: ["you"],
        }),
      }),
    ).toBe(false);
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

describe("shouldDeferBigWinForRunout", () => {
  it("defers while the cinema is playing or about to play", () => {
    expect(
      shouldDeferBigWinForRunout({
        result: result({ winnerId: "you", potMojos: "1", allInPlayerIds: ["you"] }),
        runoutPlaying: true,
        willPlayRunout: false,
      }),
    ).toBe(true);
    expect(
      shouldDeferBigWinForRunout({
        result: result({ winnerId: "you", potMojos: "1", allInPlayerIds: ["you"] }),
        runoutPlaying: false,
        willPlayRunout: true,
      }),
    ).toBe(true);
    expect(
      shouldDeferBigWinForRunout({
        result: result({ winnerId: "you", potMojos: "1" }),
        runoutPlaying: false,
        willPlayRunout: false,
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

  it("cycles through all eleven overlays in order", () => {
    for (let i = 0; i < BIG_WIN_CYCLE.length; i++) {
      const prev = BIG_WIN_CYCLE[i]!;
      const next = BIG_WIN_CYCLE[(i + 1) % BIG_WIN_CYCLE.length]!;
      expect(pickBigWinOverlay(prev)).toBe(next);
    }
  });

  it("starts with irish when there is no prior overlay", () => {
    expect(pickBigWinOverlay(null)).toBe("irish");
    expect(pickBigWinOverlay(null)).toBe("hunter");
  });

  it("parses preview hashes for every overlay", () => {
    expect(parseBigWinPreviewHash("#lucky")).toBe("irish");
    expect(parseBigWinPreviewHash("#hunter")).toBe("hunter");
    expect(parseBigWinPreviewHash("#hero")).toBe("hero");
    expect(parseBigWinPreviewHash("#big-sloth")).toBe("sloth");
    expect(parseBigWinPreviewHash("#big-terrier")).toBe("terrier");
    expect(parseBigWinPreviewHash("#big-owl")).toBe("owl");
    expect(parseBigWinPreviewHash("#big-vault")).toBe("vault");
    expect(parseBigWinPreviewHash("#big-fireworks")).toBe("fireworks");
    expect(parseBigWinPreviewHash("#big-pinata")).toBe("pinata");
    expect(parseBigWinPreviewHash("#big-ufo")).toBe("ufo");
    expect(parseBigWinPreviewHash("#big-belt")).toBe("belt");
    expect(parseBigWinPreviewHash("#nope")).toBeNull();
  });
});
