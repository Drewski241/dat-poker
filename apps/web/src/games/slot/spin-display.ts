import { evaluateSpin, PAYLINES, type SymbolId } from "@dat-poker/slot-engine";

export type SpinResponsePayload = {
  lineWinMojos: string;
  progressiveWinMojos?: string;
  netMojos: string;
  betMojos: string;
  result: {
    grid: string[][];
    lineWins: {
      lineIndex: number;
      symbol: string;
      count: number;
      multiplier: number;
      cells: { reel: number; row: number }[];
    }[];
    scatterCount: number;
    scatterMultiplier: number;
    totalPayoutMojos?: string;
  };
  wonProgressive?: boolean;
};

export type SpinDisplayWin = {
  lineIndex: number;
  symbol: string;
  count: number;
  multiplier: number;
  cells: { reel: number; row: number }[];
};

/** Prefer server wins; if the API returned none, evaluate locally for UI (same rules as server when up to date). */
export function resolveSpinDisplayWins(
  response: SpinResponsePayload,
  resultGrid: SymbolId[][],
): { wins: SpinDisplayWin[]; serverAuthoritative: boolean } {
  const fromServer = response.result.lineWins ?? [];
  if (fromServer.length > 0 || BigInt(response.lineWinMojos) > 0n) {
    return {
      wins: fromServer.map((w) => ({
        lineIndex: w.lineIndex,
        symbol: w.symbol,
        count: w.count,
        multiplier: w.multiplier,
        cells: w.cells,
      })),
      serverAuthoritative: true,
    };
  }

  const local = evaluateSpin(resultGrid, 1);
  if (local.totalPayout <= 0) {
    return { wins: [], serverAuthoritative: true };
  }

  return {
    wins: local.lineWins.map((w) => ({
      lineIndex: w.lineIndex,
      symbol: w.symbol,
      count: w.count,
      multiplier: w.multiplier,
      cells: w.cells,
    })),
    serverAuthoritative: false,
  };
}

export function grossWinMojosFromSpin(
  response: SpinResponsePayload,
  betMojos: bigint,
  resultGrid?: SymbolId[][],
): bigint {
  const progressive = BigInt(response.progressiveWinMojos ?? "0");
  const line = BigInt(response.lineWinMojos ?? "0");
  if (line + progressive > 0n) {
    return line + progressive;
  }
  const fromTotal = BigInt(response.result.totalPayoutMojos ?? "0");
  if (fromTotal + progressive > 0n) {
    return fromTotal + progressive;
  }
  const lineBetMojos = betMojos / BigInt(PAYLINES.length);
  const grid =
    resultGrid ??
    (response.result.grid?.length === 5 ? (response.result.grid as SymbolId[][]) : null);
  if (grid) {
    const local = evaluateSpin(grid, 1);
    if (local.totalPayout > 0) {
      return BigInt(local.totalPayout) * lineBetMojos + progressive;
    }
  }
  return 0n;
}
