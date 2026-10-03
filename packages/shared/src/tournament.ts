import type { PlayerId, PokerVariant, TableFormat, TableId } from "./types.js";

export type TournamentId = string;

export type TournamentStatus =
  | "registering"
  | "seating"
  | "running"
  | "final_table"
  | "completed"
  | "cancelled";

export type TournamentPlayerStatus = "registered" | "active" | "eliminated";

export interface BlindLevel {
  level: number;
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
  anteMojos: bigint;
  durationSeconds: number;
}

export interface TournamentConfig {
  id: TournamentId;
  name: string;
  /** `"sng"` = single-table; `"mtt"` = multi-table. */
  format: Extract<TableFormat, "sng" | "mtt">;
  variant: PokerVariant;
  /** Seats per table. MTT default is 8. */
  maxSeats: number;
  /**
   * Registration cap. `null` = unlimited (seat everyone who registers).
   * SNGs always use a finite cap ≤ maxSeats.
   */
  maxEntries: number | null;
  /** Minimum registrations before the tournament can start. */
  minEntries: number;
  buyInMojos: bigint;
  startingStackMojos: bigint;
  /** Blind schedule; level 0 is used at start. */
  blindLevels: BlindLevel[];
}

export interface TournamentSeat {
  tableId: TableId;
  seatIndex: number;
}

export interface TournamentPlayerSnapshot {
  playerId: PlayerId;
  status: TournamentPlayerStatus;
  stackMojos: bigint;
  tableId: TableId | null;
  seatIndex: number | null;
  finishPosition: number | null;
}

export interface TournamentTableSnapshot {
  tableId: TableId;
  closed: boolean;
  isFinalTable: boolean;
  seats: Array<{
    seatIndex: number;
    playerId: PlayerId;
    stackMojos: bigint;
  }>;
}

export interface TournamentSnapshot {
  id: TournamentId;
  name: string;
  format: Extract<TableFormat, "sng" | "mtt">;
  status: TournamentStatus;
  maxSeats: number;
  /** `null` when registration is uncapped. */
  maxEntries: number | null;
  registeredCount: number;
  activeCount: number;
  eliminatedCount: number;
  tableCount: number;
  currentLevel: number;
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
  anteMojos: bigint;
  /** Omitted when snapshot is summary-only (large fields). */
  players?: TournamentPlayerSnapshot[];
  /** Omitted when snapshot is summary-only (large fields). */
  tables?: TournamentTableSnapshot[];
  winnerId: PlayerId | null;
}

/** Lightweight tournament view for lobbies / 100k+ fields. */
export interface TournamentSummary {
  id: TournamentId;
  name: string;
  format: Extract<TableFormat, "sng" | "mtt">;
  status: TournamentStatus;
  maxSeats: number;
  maxEntries: number | null;
  registeredCount: number;
  activeCount: number;
  eliminatedCount: number;
  tableCount: number;
  currentLevel: number;
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
  anteMojos: bigint;
  winnerId: PlayerId | null;
}

/** A seating change produced by initial seat or rebalance. */
export interface SeatMove {
  playerId: PlayerId;
  from: TournamentSeat | null;
  to: TournamentSeat | null;
  reason: "initial_seat" | "balance" | "table_break" | "final_table" | "elimination";
}
