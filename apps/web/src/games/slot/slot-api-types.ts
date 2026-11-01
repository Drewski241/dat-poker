export type SlotSpinApiResult = {
  ok: boolean;
  gameId?: string;
  betMojos: string;
  lineWinMojos: string;
  progressiveWinMojos: string;
  wonProgressive: boolean;
  netMojos: string;
  accountBalanceMojos: string;
  progressiveJackpotMojos: string;
  freeSpin?: boolean;
  holdDrawOffer?: { heldReels: number[] };
  result: {
    grid: string[][];
    lineWins: {
      lineIndex: number;
      symbol: string;
      count: number;
      multiplier: number;
      payout: string;
      cells: { reel: number; row: number }[];
    }[];
    waysWins?: {
      symbol: string;
      reelCount: number;
      ways: number;
      multiplier: number;
      payout: string;
    }[];
    scatterCount: number;
    scatterMultiplier: number;
    totalPayoutMojos: string;
    winTier: string;
    meta?: Record<string, unknown>;
  };
};
