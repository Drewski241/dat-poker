/**
 * Initial seating helpers for multi-table tournaments.
 *
 * Goal: seat N players across 8-max (or configurable) tables as evenly as
 * possible so no table is more than one player fuller than another.
 */

export function tablesNeeded(playerCount: number, maxSeats: number): number {
  if (playerCount <= 0) return 0;
  if (maxSeats < 2) {
    throw new Error("maxSeats must be at least 2");
  }
  return Math.ceil(playerCount / maxSeats);
}

/**
 * Returns per-table player counts that sum to `playerCount`, each ≤ `maxSeats`,
 * with max−min ≤ 1.
 */
export function evenSeatCounts(
  playerCount: number,
  tableCount: number,
  maxSeats: number,
): number[] {
  if (tableCount <= 0) return [];
  if (playerCount > tableCount * maxSeats) {
    throw new Error(
      `Cannot seat ${playerCount} players across ${tableCount} tables of ${maxSeats}`,
    );
  }
  const base = Math.floor(playerCount / tableCount);
  const rem = playerCount % tableCount;
  return Array.from({ length: tableCount }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * Assign players round-robin into `tableCount` tables.
 * Returns arrays of player ids per table (index = table ordinal).
 */
export function assignPlayersToTables<T>(
  players: readonly T[],
  tableCount: number,
  maxSeats: number,
): T[][] {
  if (players.length === 0) return [];
  const needed = tablesNeeded(players.length, maxSeats);
  if (tableCount < needed) {
    throw new Error(`Need at least ${needed} tables for ${players.length} players`);
  }
  const counts = evenSeatCounts(players.length, tableCount, maxSeats);
  const tables: T[][] = Array.from({ length: tableCount }, () => []);
  let cursor = 0;
  for (let t = 0; t < tableCount; t++) {
    const take = counts[t]!;
    tables[t] = players.slice(cursor, cursor + take) as T[];
    cursor += take;
  }
  return tables;
}

/** First free seat index on a table, or null if full. */
export function nextOpenSeat(
  occupiedSeats: ReadonlySet<number>,
  maxSeats: number,
): number | null {
  for (let i = 0; i < maxSeats; i++) {
    if (!occupiedSeats.has(i)) return i;
  }
  return null;
}
