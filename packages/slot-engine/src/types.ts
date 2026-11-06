/** Visible symbols per reel column (game-specific ids). */
export type Grid = string[][];

export interface LineWin {
  lineIndex: number;
  symbol: string;
  count: number;
  multiplier: number;
  payout: number;
  cells: { reel: number; row: number }[];
}

export interface WaysWin {
  symbol: string;
  reelCount: number;
  ways: number;
  multiplier: number;
  /**
   * Line-unit numerator. Mojos = payout × line stake / payoutDenominator.
   * Stampede keeps this as an integer and puts 7 (or 14 on a respin) in
   * `payoutDenominator` so settlement never calls BigInt on a fraction.
   */
  payout: number;
  /** Defaults to 1 (payout is already in line-stake units). */
  payoutDenominator?: number;
  /** Cells that formed the way, so the client can light them up. */
  cells?: { reel: number; row: number }[];
  /** Stampede: opening board vs expanding-wild respin. */
  phase?: "base" | "respin";
}

export interface SlotSpinCore {
  grid: Grid;
  lineWins: LineWin[];
  waysWins: WaysWin[];
  scatterCount: number;
  scatterMultiplier: number;
  totalMultiplier: number;
  totalPayout: number;
  /** Game-specific payload (cascades, boss HP, hold phase, etc.). */
  meta?: Record<string, unknown>;
}

export interface HouseEdgeState {
  bossHp: number;
  freeSpinsRemaining: number;
  bossBonusActive: boolean;
}
