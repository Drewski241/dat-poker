import { describe, expect, it, beforeEach } from "vitest";
import { NlheTableEngine } from "@dat-poker/game-engine";
import { DAT_TABLE_DEFAULTS } from "@dat-poker/shared";
import { HOUSE_PLAYER_ID, resetTablesForTests, syncHouseSeating } from "./routes/tables.js";

const buyIn = DAT_TABLE_DEFAULTS.minBuyInMojos;

function tableConfig() {
  return {
    id: "t1",
    variant: "nlhe" as const,
    format: "cash" as const,
    maxSeats: 6,
    smallBlindMojos: DAT_TABLE_DEFAULTS.smallBlindMojos,
    bigBlindMojos: DAT_TABLE_DEFAULTS.bigBlindMojos,
    minBuyInMojos: buyIn,
    maxBuyInMojos: DAT_TABLE_DEFAULTS.maxBuyInMojos,
    rakeBps: 500,
  };
}

describe("syncHouseSeating", () => {
  beforeEach(() => {
    resetTablesForTests();
  });

  it("reseats the house after an all-in bust left it at zero stack", () => {
    const table = new NlheTableEngine(tableConfig());
    table.seatPlayer("alice", 0, buyIn);
    table.seatPlayer(HOUSE_PLAYER_ID, 1, buyIn);

    table.debitStack(HOUSE_PLAYER_ID, buyIn);
    expect(table.hasPlayer(HOUSE_PLAYER_ID)).toBe(false);

    syncHouseSeating(table, buyIn);

    expect(table.hasPlayer(HOUSE_PLAYER_ID)).toBe(true);
    expect(table.getPlayerStack(HOUSE_PLAYER_ID)).toBe(buyIn);
    expect(table.activeSeatedPlayers()).toHaveLength(2);
  });

  it("reseats the house when it is still seated at zero stack", () => {
    const table = new NlheTableEngine(tableConfig());
    table.seatPlayer("alice", 0, buyIn);
    table.seatPlayer(HOUSE_PLAYER_ID, 1, buyIn);

    const internal = table as unknown as { stacks: Map<string, bigint> };
    internal.stacks.set(HOUSE_PLAYER_ID, 0n);

    expect(table.hasPlayer(HOUSE_PLAYER_ID)).toBe(true);
    expect(table.getPlayerStack(HOUSE_PLAYER_ID)).toBe(0n);

    syncHouseSeating(table, buyIn);

    expect(table.hasPlayer(HOUSE_PLAYER_ID)).toBe(true);
    expect(table.getPlayerStack(HOUSE_PLAYER_ID)).toBe(buyIn);
    expect(table.activeSeatedPlayers()).toHaveLength(2);
  });
});
