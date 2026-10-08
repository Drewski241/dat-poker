import { describe, expect, it } from "vitest";
import { groupLobbyTables } from "./lobby-mtt.js";
import type { LobbyTable } from "./api.js";

function mttRow(eventId: string, tableId: string, label: string, humans: string[] = []): LobbyTable {
  return {
    tableId,
    format: "mtt",
    handInProgress: false,
    players: 8,
    humanCount: humans.length,
    humanPlayerIds: humans,
    houseSeatsAvailable: 8 - humans.length,
    sng: {
      status: "running",
      kind: "mtt",
      eventId,
      tableLabel: label,
      fieldSize: 500,
      maxSeats: 8,
      buyInMojos: "1000000",
      prizePoolMojos: "500000000",
      smallBlindMojos: "10000",
      bigBlindMojos: "20000",
      playersRemaining: 8,
      humanCount: humans.length,
      houseSeatsAvailable: 8 - humans.length,
      handNumber: 0,
      placements: [],
    },
  };
}

describe("groupLobbyTables", () => {
  it("groups MTT tables by event and leaves SNG rows separate", () => {
    const rows = [
      mttRow("ev1", "t1", "Table 1"),
      mttRow("ev1", "t2", "Table 2"),
      mttRow("ev1", "t3", "Table 3", ["alice"]),
      {
        tableId: "sng1",
        format: "sng" as const,
        handInProgress: false,
        players: 9,
        sng: {
          status: "running" as const,
          kind: "sng" as const,
          maxSeats: 9,
          buyInMojos: "1000000",
          prizePoolMojos: "9000000",
          smallBlindMojos: "10000",
          bigBlindMojos: "20000",
          playersRemaining: 9,
          humanCount: 1,
          houseSeatsAvailable: 7,
          handNumber: 0,
          placements: [],
        },
      } satisfies LobbyTable,
    ] satisfies LobbyTable[];
    const { mttEvents, sngRows } = groupLobbyTables(rows, "alice");
    expect(mttEvents).toHaveLength(1);
    expect(mttEvents[0]!.tableCount).toBe(3);
    expect(mttEvents[0]!.myTableId).toBe("t3");
    expect(mttEvents[0]!.humanCount).toBe(1);
    expect(sngRows).toHaveLength(1);
  });
});
