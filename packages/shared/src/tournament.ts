import type { PlayerId, PokerVariant, TableFormat, TableId } from "./types.js";

export type TournamentId = string;

export type TournamentStatus =
  | "registering"
  | "seating"
  | "running"
  | "final_table"
  | "completed"
  | "cancelled";

export type TournamentPlayerStatus =
  | "registered"
  | "active"
  | "eliminated"
  | "waiting_seat"; // late reg / re-entry pending seat

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
  /** Rake/fee in basis points taken from each entry (0–10000). */
  feeBps: number;
  /**
   * Late registration stays open through this blind level index (inclusive).
   * `-1` = closed once started; default `3` for MTT, `-1` for SNG.
   */
  lateRegThroughLevel: number;
  /** Allow busted players to buy back in while late reg is open. */
  reentryAllowed: boolean;
  /** Max re-entries per player (0 = none). Ignored if reentryAllowed is false. */
  maxReentries: number;
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
  /** Cash prize locked in at elimination / win (0 if still playing / unpaid). */
  prizeMojos: bigint;
  entriesUsed: number;
  reentriesUsed: number;
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

export interface PayoutLadderRow {
  place: number;
  pct: number;
  amountMojos: bigint;
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
  lateRegOpen: boolean;
  prizePoolMojos: bigint;
  paidPlaces: number;
  payoutLadder?: PayoutLadderRow[];
  handForHand?: {
    active: boolean;
    reason: string | null;
    waitingOn: string[];
    completed: string[];
    wave: number;
  };
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
  lateRegOpen: boolean;
  prizePoolMojos: bigint;
  paidPlaces: number;
  handForHandActive: boolean;
  winnerId: PlayerId | null;
}

/** A seating change produced by initial seat or rebalance. */
export interface SeatMove {
  playerId: PlayerId;
  from: TournamentSeat | null;
  to: TournamentSeat | null;
  reason:
    | "initial_seat"
    | "balance"
    | "table_break"
    | "final_table"
    | "elimination"
    | "late_reg"
    | "reentry";
}
