import type { PokerVariant, TableFormat } from "./types.js";

/**
 * Player-facing wager. DAT POKER never stakes XCH.
 * XCH may still pay a Chia network fee. That fee is not a pot.
 */
export const DAT_WAGER_ASSET = "dat" as const;
export type WagerAsset = typeof DAT_WAGER_ASSET;

export type HybridPlayMode = "waiting" | "chia-gaming-heads-up" | "dat-table-vault";

export const MIN_TABLE_SEATS = 2;
export const MAX_TABLE_SEATS = 10;

export class WagerPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WagerPolicyError";
  }
}

export interface HybridDecision {
  mode: HybridPlayMode;
  wagerAsset: WagerAsset;
  /** Always zero. Players do not fund a chia-gaming channel with an XCH stake. */
  xchWagerMojos: 0n;
  /**
   * True when a 3+ table freezes its vault and finishes on a chia-gaming channel
   * once only two players remain.
   */
  headsUpPromotion: boolean;
  reason: string;
}

const TABLE_FORMATS: readonly TableFormat[] = ["cash", "sng", "mtt"];

export function isTableFormat(value: string): value is TableFormat {
  return (TABLE_FORMATS as readonly string[]).includes(value);
}

/** Refuse every stake that is not the DAT governance token. */
export function assertDatOnlyWager(unit: string | null | undefined): void {
  if (unit == null || unit === "" || unit === DAT_WAGER_ASSET) {
    return;
  }
  throw new WagerPolicyError(
    `DAT POKER wagers the DAT governance token only (refused "${unit}"). XCH pays network fees, not pots.`,
  );
}

export function assertSeatCount(maxSeats: number): void {
  if (!Number.isInteger(maxSeats) || maxSeats < MIN_TABLE_SEATS || maxSeats > MAX_TABLE_SEATS) {
    throw new Error(`maxSeats must be an integer from ${MIN_TABLE_SEATS} to ${MAX_TABLE_SEATS}`);
  }
}

/**
 * Pick the custody path for a table.
 *
 * chia-gaming state channels are pairwise. Every variant can use one when
 * exactly two players are in the hand. Three or more players lock DAT in
 * this platform's table vault. Sit & Go and multi-table events use that same
 * vault per table, then promote to a channel at heads-up. That promotion is
 * ours; it does not wait on upstream multi-table channel work.
 */
export function resolveHybridPlay(input: {
  seated: number;
  maxSeats: number;
  format: TableFormat;
  variant?: PokerVariant;
}): HybridDecision {
  assertSeatCount(input.maxSeats);
  if (input.seated < 0 || input.seated > input.maxSeats) {
    throw new Error("seated count is outside this table");
  }

  const headsUpPromotion = input.maxSeats > 2;
  const base = {
    wagerAsset: DAT_WAGER_ASSET,
    xchWagerMojos: 0n as const,
    headsUpPromotion,
  };

  if (input.seated < 2) {
    return {
      ...base,
      mode: "waiting",
      reason: headsUpPromotion
        ? "Waiting for players. Three or more settle in the DAT table vault. When only two remain, the vault freezes and the rest of the match is a chia-gaming channel. The stake is DAT."
        : "Heads-up table. Both seats open a chia-gaming channel. The stake is DAT. XCH is not wagered.",
    };
  }

  if (input.seated === 2) {
    return {
      ...base,
      mode: "chia-gaming-heads-up",
      reason:
        "Two players. Game messages and the signed result use a chia-gaming state channel. The pot is DAT, not XCH. A variant with an upstream referee can run inside the channel; every other variant runs on the DAT POKER engine and the channel carries the co-signed result.",
    };
  }

  return {
    ...base,
    mode: "dat-table-vault",
    headsUpPromotion: true,
    reason:
      "Three or more players. A chia-gaming channel holds two players, so this pot lives in the DAT table vault. Each hand's stacks stick once every seated player co-signs. If someone withholds a signature, balances stay on the last co-signed vector. When the table shrinks to two, the vault freezes and play continues on a chia-gaming channel. Sit & Go and tournament tables use this per table, without waiting on an upstream multi-table channel.",
  };
}
