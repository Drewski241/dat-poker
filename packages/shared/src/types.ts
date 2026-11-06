export type PlayerId = string;
export type TableId = string;
export type HandId = string;
export type SessionId = string;

export type PokerVariant =
  | "nlhe"
  | "plhe"
  | "plo4"
  | "plo5"
  | "plo6"
  | "plo4_hl"
  | "pineapple"
  | "crazy_pineapple"
  | "lazy_pineapple"
  | "five_card_draw"
  | "triple_draw_27"
  | "badugi"
  | "draw"
  | "stud"
  | "seven_card_stud"
  | "razz"
  | "horse"
  | "calpoker"
  | "omaha";

export type TableFormat = "cash" | "sng" | "mtt";

export type CurrencyUnit = "xch" | "cat" | "dat";

export interface Money {
  amountMojos: bigint;
  unit: CurrencyUnit;
}

export interface PlayerProfile {
  id: PlayerId;
  displayName: string;
  region?: string;
}

export interface TableConfig {
  id: TableId;
  variant: PokerVariant;
  format: TableFormat;
  maxSeats: number;
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
  minBuyInMojos: bigint;
  maxBuyInMojos: bigint;
  rakeBps: number;
}

export interface SeatState {
  seatIndex: number;
  playerId: PlayerId | null;
  stackMojos: bigint;
  sittingOut: boolean;
}

/** Community-card streets plus discard (pineapple) and showdown. */
export type Street =
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "discard"
  | "showdown";

/** Draw-family streets (used by DrawTableEngine). */
export type DrawStreet =
  | "betting1"
  | "draw1"
  | "betting2"
  | "draw2"
  | "betting3"
  | "draw3"
  | "betting4"
  | "showdown";

/** Stud-family streets (used by StudTableEngine). */
export type StudStreet =
  | "third"
  | "fourth"
  | "fifth"
  | "sixth"
  | "seventh"
  | "showdown";

export interface HandCommitment {
  handId: HandId;
  tableId: TableId;
  commitHash: string;
  createdAt: string;
}

export interface HandReveal {
  handId: HandId;
  serverSeed: string;
  playerSeeds: Record<PlayerId, string>;
}

export interface SettlementProof {
  handId: HandId;
  tableId: TableId;
  stateRootHash: string;
  payouts: Array<{ playerId: PlayerId; deltaMojos: bigint }>;
  chiaTxId?: string;
}
