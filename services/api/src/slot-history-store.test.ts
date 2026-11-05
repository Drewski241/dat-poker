import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listSlotHistory,
  recordSlotSpin,
  resetSlotHistoryForTests,
  type SlotHistoryEntry,
} from "./slot-history-store.js";

function spin(gameId: SlotHistoryEntry["gameId"], bet: string): Omit<SlotHistoryEntry, "id" | "at"> {
  return {
    gameId,
    betMojos: bet,
    lineWinMojos: "0",
    progressiveWinMojos: "0",
    netMojos: `-${bet}`,
    wonProgressive: false,
    freeSpin: false,
    drawPhase: false,
    lineWins: [],
    waysWins: [],
    scatterCount: 0,
    scatterMultiplier: 0,
    cascadeSteps: 0,
    expandingWild: false,
  };
}

describe("slot history", () => {
  afterEach(() => {
    delete process.env.DAT_SLOT_HISTORY_PATH;
    resetSlotHistoryForTests();
  });

  it("keeps each game's spins separate and newest first", () => {
    process.env.DAT_SLOT_HISTORY_PATH = "memory";
    resetSlotHistoryForTests();
    recordSlotSpin("alice", spin("spirit", "1000"));
    recordSlotSpin("alice", {
      ...spin("mine-mojo", "20000"),
      lineWinMojos: "4000",
      netMojos: "-16000",
      lineWins: [{ lineIndex: 1, symbol: "emerald", count: 3, multiplier: 2 }],
      cascadeSteps: 1,
    });
    recordSlotSpin("bob", spin("spirit", "5000"));

    expect(listSlotHistory("alice", "spirit")).toHaveLength(1);
    expect(listSlotHistory("alice", "mine-mojo")[0]?.lineWins[0]?.symbol).toBe("emerald");
    expect(listSlotHistory("bob", "spirit")[0]?.betMojos).toBe("5000");
    expect(listSlotHistory("alice", "house-edge")).toEqual([]);
  });

  it("drops spins past the per-game cap and reloads them from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "slot-history-"));
    process.env.DAT_SLOT_HISTORY_PATH = join(dir, "slot-history.json");
    resetSlotHistoryForTests();
    for (let i = 0; i < 45; i++) {
      recordSlotSpin("alice", { ...spin("poker-hands", "1000"), netMojos: String(i) });
    }
    expect(listSlotHistory("alice", "poker-hands")).toHaveLength(40);
    expect(listSlotHistory("alice", "poker-hands")[0]?.netMojos).toBe("44");

    resetSlotHistoryForTests();
    expect(listSlotHistory("alice", "poker-hands")[39]?.netMojos).toBe("5");
  });
});
