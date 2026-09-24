import { describe, expect, it } from "vitest";
import {
  DAT_SNG_DEFAULTS,
  defaultSngPayouts,
  houseSeatPlayerId,
  isHousePlayerId,
  HOUSE_PLAYER_ID,
  sngPrizes,
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
  });

  it("pays 50/30/20 and gives rounding dust to first", () => {
    const prizes = sngPrizes(9_000_001n, defaultSngPayouts(9));
    expect(prizes.get(2)).toBe(2_700_000n);
    expect(prizes.get(3)).toBe(1_800_000n);
    expect(prizes.get(1)).toBe(9_000_001n - 2_700_000n - 1_800_000n);
    expect((prizes.get(1) ?? 0n) + (prizes.get(2) ?? 0n) + (prizes.get(3) ?? 0n)).toBe(9_000_001n);
  });
});
