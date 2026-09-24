import { describe, expect, it } from "vitest";
import {
  DAT_SNG_DEFAULTS,
  defaultSngPayouts,
  houseSeatPlayerId,
  isHousePlayerId,
  HOUSE_PLAYER_ID,
  sngHandsUntilNextLevel,
  sngNextLevelAtMs,
  sngPrizes,
  sngTargetBlindLevel,
  assignSngItmPrizes,
} from "./sng.js";

describe("SNG helpers", () => {
  it("identifies house seats including the cash-table house id", () => {
    expect(isHousePlayerId(HOUSE_PLAYER_ID)).toBe(true);
    expect(isHousePlayerId(houseSeatPlayerId(3))).toBe(true);
    expect(isHousePlayerId("xch1alice")).toBe(false);
  });

  it("defaults to a 9-max fill-house SNG", () => {
    expect(DAT_SNG_DEFAULTS.maxSeats).toBe(9);
    expect(DAT_SNG_DEFAULTS.fillHouse).toBe(true);
    expect(DAT_SNG_DEFAULTS.minHumansToStart).toBe(1);
    expect(DAT_SNG_DEFAULTS.levelDurationMs).toBe(3 * 60 * 1000);
    expect(DAT_SNG_DEFAULTS.handsPerLevel).toBe(4);
    expect(DAT_SNG_DEFAULTS.blindLevels.length).toBeGreaterThan(1);
  });

  it("raises the blind level on the clock and after enough hands", () => {
    const base = {
      startedAtMs: 1_000,
      handNumber: 1,
      levelDurationMs: 60_000,
      handsPerLevel: 4,
      levelCount: 9,
    };
    expect(sngTargetBlindLevel({ ...base, nowMs: 1_000 })).toBe(0);
    expect(sngTargetBlindLevel({ ...base, nowMs: 60_999 })).toBe(0);
    expect(sngTargetBlindLevel({ ...base, nowMs: 61_000 })).toBe(1);
    expect(sngTargetBlindLevel({ ...base, nowMs: 181_000 })).toBe(3);
    expect(sngTargetBlindLevel({ ...base, nowMs: 1_000, handNumber: 5 })).toBe(1);
    expect(sngTargetBlindLevel({ ...base, nowMs: 1_000, handNumber: 9 })).toBe(2);
    expect(sngTargetBlindLevel({ ...base, nowMs: 1_000_000, handNumber: 1 })).toBe(8);
    expect(sngNextLevelAtMs({ startedAtMs: 1_000, levelIndex: 0, levelDurationMs: 60_000, levelCount: 9 })).toBe(
      61_000,
    );
    expect(sngNextLevelAtMs({ startedAtMs: 1_000, levelIndex: 8, levelDurationMs: 60_000, levelCount: 9 })).toBeNull();
    expect(sngHandsUntilNextLevel({ handNumber: 1, levelIndex: 0, handsPerLevel: 4, levelCount: 9 })).toBe(4);
    expect(sngHandsUntilNextLevel({ handNumber: 4, levelIndex: 0, handsPerLevel: 4, levelCount: 9 })).toBe(1);
  });

  it("pays only humans who finish 1st–3rd overall; house ITM shares stay unpaid", () => {
    const awarded = assignSngItmPrizes(
      [
        { playerId: "dat-poker:house:1", place: 1, prizeMojos: 0n },
        { playerId: "dat-poker:house:2", place: 2, prizeMojos: 0n },
        { playerId: "carol", place: 3, prizeMojos: 0n },
        { playerId: "bob", place: 4, prizeMojos: 0n },
        { playerId: "alice", place: 9, prizeMojos: 0n },
      ],
      3_000_000n,
    );
    expect(awarded.find((row) => row.playerId === "carol")?.prizeMojos).toBe(600_000n);
    expect(awarded.find((row) => row.playerId === "bob")?.prizeMojos).toBe(0n);
    expect(awarded.find((row) => row.playerId === "alice")?.prizeMojos).toBe(0n);
    expect(awarded.filter((row) => row.playerId.startsWith("dat-poker:house")).every((row) => row.prizeMojos === 0n)).toBe(
      true,
    );
  });

  it("pays 50/30/20 and gives rounding dust to first", () => {
    const prizes = sngPrizes(9_000_001n, defaultSngPayouts(9));
    expect(prizes.get(2)).toBe(2_700_000n);
    expect(prizes.get(3)).toBe(1_800_000n);
    expect(prizes.get(1)).toBe(9_000_001n - 2_700_000n - 1_800_000n);
    expect((prizes.get(1) ?? 0n) + (prizes.get(2) ?? 0n) + (prizes.get(3) ?? 0n)).toBe(9_000_001n);
  });
});
