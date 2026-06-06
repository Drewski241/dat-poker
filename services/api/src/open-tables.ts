import type { TableConfig } from "@dat-poker/shared";
import { DAT_TABLE_DEFAULTS, resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { NlheTableEngine } from "@dat-poker/game-engine";
import { readDatTokenConfig } from "./wallet-config.js";

export const HOUSE_PLAYER_ID = "dat-poker:house";
export const DEFAULT_MAX_SEATS = 6;

export interface OpenTableSummary {
  tableId: string;
  players: number;
  openSeats: number;
  handInProgress: boolean;
  joinable: boolean;
}

export function findOpenSeatIndex(
  table: NlheTableEngine,
  maxSeats = DEFAULT_MAX_SEATS,
): number | null {
  const taken = new Set(table.getSeatedPlayers().map((seat) => seat.seatIndex));
  for (let seatIndex = 0; seatIndex < maxSeats; seatIndex += 1) {
    if (!taken.has(seatIndex)) return seatIndex;
  }
  return null;
}

export function findPlayerSeat(
  tables: Map<string, NlheTableEngine>,
  playerId: string,
): { tableId: string; seatIndex: number } | null {
  for (const [tableId, table] of tables) {
    const seat = table.getSeatedPlayers().find((entry) => entry.playerId === playerId);
    if (seat) {
      return { tableId, seatIndex: seat.seatIndex };
    }
  }
  return null;
}

export function isJoinableTable(table: NlheTableEngine, maxSeats = DEFAULT_MAX_SEATS): boolean {
  if (table.isHandInProgress()) return false;
  const seats = table.getSeatedPlayers();
  const hasHouse = seats.some((seat) => seat.playerId === HOUSE_PLAYER_ID);
  if (!hasHouse) return false;
  return seats.length < maxSeats;
}

export function findJoinableTableId(
  tables: Map<string, NlheTableEngine>,
  maxSeats = DEFAULT_MAX_SEATS,
): string | null {
  for (const [tableId, table] of tables) {
    if (isJoinableTable(table, maxSeats)) {
      return tableId;
    }
  }
  return null;
}

export function summarizeOpenTables(
  tables: Map<string, NlheTableEngine>,
  maxSeats = DEFAULT_MAX_SEATS,
): OpenTableSummary[] {
  return [...tables.entries()].map(([tableId, table]) => {
    const players = table.getActivePlayerCount();
    const joinable = isJoinableTable(table, maxSeats);
    return {
      tableId,
      players,
      openSeats: Math.max(0, maxSeats - players),
      handInProgress: table.isHandInProgress(),
      joinable,
    };
  });
}

export function buildDefaultTableConfig(tableId: string, maxSeats = DEFAULT_MAX_SEATS): TableConfig {
  const dat = readDatTokenConfig();
  const useDatStakes = Boolean(dat.assetId);
  const minBuyIn = useDatStakes
    ? resolveDatMinBuyInMojos(dat.minBuyInMojos)
    : DAT_TABLE_DEFAULTS.minBuyInMojos;

  return {
    id: tableId,
    variant: "nlhe",
    format: "cash",
    maxSeats,
    smallBlindMojos: useDatStakes ? DAT_TABLE_DEFAULTS.smallBlindMojos : 50_000_000_000n,
    bigBlindMojos: useDatStakes ? DAT_TABLE_DEFAULTS.bigBlindMojos : 100_000_000_000n,
    minBuyInMojos: minBuyIn,
    maxBuyInMojos: useDatStakes ? DAT_TABLE_DEFAULTS.maxBuyInMojos : 20_000_000_000_000n,
    rakeBps: 500,
  };
}

export function createOpenTableWithHouse(
  tables: Map<string, NlheTableEngine>,
  tableId: string,
  buyInMojos: bigint,
  maxSeats = DEFAULT_MAX_SEATS,
): NlheTableEngine {
  const table = new NlheTableEngine(buildDefaultTableConfig(tableId, maxSeats));
  table.seatPlayer(HOUSE_PLAYER_ID, 1, buyInMojos);
  tables.set(tableId, table);
  return table;
}
