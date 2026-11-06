import { describe, expect, it } from "vitest";
import { formatSlotHistoryEntry, type SlotHistoryEntry } from "./slot-history.js";

function entry(partial: Partial<SlotHistoryEntry>): SlotHistoryEntry {
  return {
    id: "1",
    at: "2026-11-05T18:00:00.000Z",
    gameId: "spirit",
    betMojos: "1000",
    lineWinMojos: "0",
    progressiveWinMojos: "0",
    netMojos: "-1000",
    wonProgressive: false,
    freeSpin: false,
    drawPhase: false,
    lineWins: [],
    waysWins: [],
    scatterCount: 0,
    scatterMultiplier: 0,
    cascadeSteps: 0,
    expandingWild: false,
    ...partial,
  };
}

describe("formatSlotHistoryEntry", () => {
  it("names each line on a Spirit win", () => {
    const text = formatSlotHistoryEntry(
      entry({
        lineWinMojos: "5000",
        netMojos: "4000",
        lineWins: [{ lineIndex: 1, symbol: "seven", count: 3, multiplier: 5 }],
      }),
      "DAT",
    );
    expect(text).toContain("Line 2 · Top row: Lucky 7 ×3 (5×)");
    expect(text).toContain("Won 5 DAT");
    expect(text).toContain("Net +4 DAT");
  });

  it("keeps a Mine the Mojo cascade readable after the reels move on", () => {
    const text = formatSlotHistoryEntry(
      entry({
        gameId: "mine-mojo",
        betMojos: "20000",
        lineWinMojos: "96990",
        netMojos: "76990",
        cascadeSteps: 5,
        lineWins: [{ lineIndex: 0, symbol: "emerald", count: 3, multiplier: 2 }],
      }),
      "DAT",
    );
    expect(text.startsWith("5 cascades · Line 1 · Center row: Mojo Ore ×3 (2×)")).toBe(true);
  });

  it("records a poker draw that missed", () => {
    expect(formatSlotHistoryEntry(entry({ gameId: "poker-hands", drawPhase: true }), "DAT")).toBe(
      "Draw — No win this spin.",
    );
  });
});
