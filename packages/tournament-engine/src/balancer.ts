import type { PlayerId, TableId } from "@dat-poker/shared";
import type { SeatMove, TournamentSeat } from "@dat-poker/shared";
import { nextOpenSeat, tablesNeeded } from "./seating.js";

export interface BalancerPlayer {
  playerId: PlayerId;
  stackMojos: bigint;
  tableId: TableId | null;
  seatIndex: number | null;
}

export interface BalancerTable {
  tableId: TableId;
  closed: boolean;
  isFinalTable: boolean;
  /** seatIndex → playerId */
  seats: Map<number, PlayerId>;
}

export interface BalanceResult {
  moves: SeatMove[];
  tables: BalancerTable[];
  isFinalTable: boolean;
}

function occupiedSet(table: BalancerTable): Set<number> {
  return new Set(table.seats.keys());
}

function openTables(tables: BalancerTable[]): BalancerTable[] {
  return tables.filter((t) => !t.closed);
}

function cloneTables(tables: BalancerTable[]): BalancerTable[] {
  return tables.map((t) => ({
    tableId: t.tableId,
    closed: t.closed,
    isFinalTable: t.isFinalTable,
    seats: new Map(t.seats),
  }));
}

function removePlayerFromTables(
  tables: BalancerTable[],
  playerId: PlayerId,
): TournamentSeat | null {
  for (const table of tables) {
    for (const [seatIndex, seatedId] of table.seats) {
      if (seatedId === playerId) {
        table.seats.delete(seatIndex);
        return { tableId: table.tableId, seatIndex };
      }
    }
  }
  return null;
}

function placePlayer(
  table: BalancerTable,
  playerId: PlayerId,
  maxSeats: number,
): number {
  const seat = nextOpenSeat(occupiedSet(table), maxSeats);
  if (seat === null) {
    throw new Error(`No open seat on table ${table.tableId}`);
  }
  table.seats.set(seat, playerId);
  return seat;
}

/**
 * Rebalance after eliminations so live tables stay as even as possible,
 * break surplus tables when capacity allows, and collapse to a final table
 * when remaining players fit on one table.
 */
export function rebalanceTables(
  tablesInput: BalancerTable[],
  activePlayers: BalancerPlayer[],
  maxSeats: number,
  allocateTableId: () => TableId,
): BalanceResult {
  if (maxSeats < 2) {
    throw new Error("maxSeats must be at least 2");
  }

  const tables = cloneTables(tablesInput);
  const moves: SeatMove[] = [];
  const activeIds = new Set(activePlayers.map((p) => p.playerId));

  // Drop any seats that are no longer active (caller should have removed, but be safe).
  for (const table of tables) {
    for (const [seat, pid] of [...table.seats.entries()]) {
      if (!activeIds.has(pid)) {
        table.seats.delete(seat);
      }
    }
  }

  const liveCount = activePlayers.length;
  if (liveCount === 0) {
    for (const table of tables) {
      if (!table.closed) {
        table.closed = true;
        table.isFinalTable = false;
        table.seats.clear();
      }
    }
    return { moves, tables, isFinalTable: false };
  }

  // Final table: everyone fits on one table.
  if (liveCount <= maxSeats) {
    return mergeToFinalTable(tables, activePlayers, maxSeats, allocateTableId, moves);
  }

  const minTables = tablesNeeded(liveCount, maxSeats);
  let live = openTables(tables).filter((t) => t.seats.size > 0 || !t.closed);

  // Ensure we have enough open tables (rare: if somehow under-provisioned).
  while (openTables(tables).length < minTables) {
    tables.push({
      tableId: allocateTableId(),
      closed: false,
      isFinalTable: false,
      seats: new Map(),
    });
  }

  // Break surplus tables: move players off the shortest until we reach minTables.
  live = openTables(tables);
  while (live.filter((t) => t.seats.size > 0).length > minTables) {
    const candidates = live.filter((t) => t.seats.size > 0);
    candidates.sort((a, b) => a.seats.size - b.seats.size || a.tableId.localeCompare(b.tableId));
    const victim = candidates[0]!;
    const destinations = live
      .filter((t) => t.tableId !== victim.tableId && !t.closed)
      .sort((a, b) => a.seats.size - b.seats.size || a.tableId.localeCompare(b.tableId));

    for (const [seatIndex, playerId] of [...victim.seats.entries()]) {
      const dest = destinations.find((t) => t.seats.size < maxSeats);
      if (!dest) {
        throw new Error("Cannot break table: no destination capacity");
      }
      victim.seats.delete(seatIndex);
      const newSeat = placePlayer(dest, playerId, maxSeats);
      moves.push({
        playerId,
        from: { tableId: victim.tableId, seatIndex },
        to: { tableId: dest.tableId, seatIndex: newSeat },
        reason: "table_break",
      });
      destinations.sort((a, b) => a.seats.size - b.seats.size || a.tableId.localeCompare(b.tableId));
    }

    victim.closed = true;
    victim.isFinalTable = false;
    live = openTables(tables);
  }

  // Even out remaining open tables (max − min ≤ 1).
  for (;;) {
    const activeTables = openTables(tables).filter((t) => t.seats.size > 0);
    if (activeTables.length <= 1) break;

    activeTables.sort((a, b) => b.seats.size - a.seats.size || a.tableId.localeCompare(b.tableId));
    const fullest = activeTables[0]!;
    const shortest = activeTables[activeTables.length - 1]!;
    if (fullest.seats.size - shortest.seats.size <= 1) break;
    if (shortest.seats.size >= maxSeats) break;

    const [fromSeat, playerId] = [...fullest.seats.entries()].sort((a, b) => b[0] - a[0])[0]!;
    fullest.seats.delete(fromSeat);
    const newSeat = placePlayer(shortest, playerId, maxSeats);
    moves.push({
      playerId,
      from: { tableId: fullest.tableId, seatIndex: fromSeat },
      to: { tableId: shortest.tableId, seatIndex: newSeat },
      reason: "balance",
    });
  }

  // Close empty non-final tables.
  for (const table of tables) {
    if (!table.closed && table.seats.size === 0) {
      table.closed = true;
    }
  }

  return { moves, tables, isFinalTable: false };
}

function mergeToFinalTable(
  tables: BalancerTable[],
  activePlayers: BalancerPlayer[],
  maxSeats: number,
  allocateTableId: () => TableId,
  moves: SeatMove[],
): BalanceResult {
  // Prefer an existing open table as the final; otherwise allocate one.
  let final =
    openTables(tables).find((t) => t.isFinalTable) ??
    openTables(tables).sort((a, b) => b.seats.size - a.seats.size || a.tableId.localeCompare(b.tableId))[0];

  if (!final) {
    final = {
      tableId: allocateTableId(),
      closed: false,
      isFinalTable: true,
      seats: new Map(),
    };
    tables.push(final);
  }

  final.isFinalTable = true;
  final.closed = false;

  const alreadyOnFinal = new Set(final.seats.values());
  for (const player of activePlayers) {
    if (alreadyOnFinal.has(player.playerId)) continue;

    const from = removePlayerFromTables(
      tables.filter((t) => t.tableId !== final!.tableId),
      player.playerId,
    );
    // Player might already have been only on final after remove from others —
    // if still missing, place them.
    if (![...final.seats.values()].includes(player.playerId)) {
      const seatIndex = placePlayer(final, player.playerId, maxSeats);
      moves.push({
        playerId: player.playerId,
        from,
        to: { tableId: final.tableId, seatIndex },
        reason: "final_table",
      });
    }
  }

  // Close every other table.
  for (const table of tables) {
    if (table.tableId === final.tableId) continue;
    table.seats.clear();
    table.closed = true;
    table.isFinalTable = false;
  }

  return { moves, tables, isFinalTable: true };
}
