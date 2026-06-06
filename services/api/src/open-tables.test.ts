import { describe, expect, it } from "vitest";
import { NlheTableEngine } from "@dat-poker/game-engine";
import {
  DEFAULT_MAX_SEATS,
  HOUSE_PLAYER_ID,
  buildDefaultTableConfig,
  findJoinableTableId,
  findOpenSeatIndex,
  findPlayerSeat,
  isJoinableTable,
} from "./open-tables.js";

describe("open tables", () => {
  it("finds an open seat on a partially filled table", () => {
    const table = new NlheTableEngine(buildDefaultTableConfig("table-1"));
    table.seatPlayer(HOUSE_PLAYER_ID, 1, 1_000_000n);
    table.seatPlayer("xch1player", 0, 1_000_000n);
    expect(findOpenSeatIndex(table, DEFAULT_MAX_SEATS)).toBe(2);
  });

  it("treats house tables without an active hand as joinable", () => {
    const table = new NlheTableEngine(buildDefaultTableConfig("table-1"));
    table.seatPlayer(HOUSE_PLAYER_ID, 1, 1_000_000n);
    expect(isJoinableTable(table)).toBe(true);
  });

  it("finds joinable tables in the registry", () => {
    const tables = new Map<string, NlheTableEngine>();
    const open = new NlheTableEngine(buildDefaultTableConfig("open-table"));
    open.seatPlayer(HOUSE_PLAYER_ID, 1, 1_000_000n);
    tables.set("open-table", open);

    const full = new NlheTableEngine(buildDefaultTableConfig("full-table"));
    for (let seatIndex = 0; seatIndex < DEFAULT_MAX_SEATS; seatIndex += 1) {
      full.seatPlayer(`player-${seatIndex}`, seatIndex, 1_000_000n);
    }
    tables.set("full-table", full);

    expect(findJoinableTableId(tables)).toBe("open-table");
  });

  it("finds an existing seat for a returning player", () => {
    const tables = new Map<string, NlheTableEngine>();
    const table = new NlheTableEngine(buildDefaultTableConfig("table-1"));
    table.seatPlayer("xch1abc", 0, 1_000_000n);
    tables.set("table-1", table);

    expect(findPlayerSeat(tables, "xch1abc")).toEqual({ tableId: "table-1", seatIndex: 0 });
  });
});
