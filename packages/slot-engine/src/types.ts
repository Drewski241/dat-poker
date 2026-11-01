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
  payout: number;
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
