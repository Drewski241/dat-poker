import { PAYLINES } from "@dat-poker/slot-engine";
import { paylineDisplayName } from "./SlotPaylineOverlay.js";

/** Opening reels stop slowly enough to read the board, on wins and losses. */
export const LINE_STOP_MS = [1500, 1950, 2400, 2850, 3300] as const;
/** How long one winning line stays lit. */
export const LINE_HOLD_MS = 2200;

export type LineCell = { reel: number; row: number };

export type LineWinInput = {
  lineIndex: number;
  symbol: string;
  count: number;
  multiplier: number;
  cells: LineCell[];
};

export type LineCue = {
  kind: "line";
  lineIndex: number | null;
  cells: LineCell[];
  label: string;
  ms: number;
};

function formatMult(multiplier: number): string {
  const rounded = Math.round(multiplier * 100) / 100;
  return String(rounded);
}

function cellsForSymbol(grid: string[][], symbol: string): LineCell[] {
  const cells: LineCell[] = [];
  for (let reel = 0; reel < grid.length; reel++) {
    const col = grid[reel] ?? [];
    for (let row = 0; row < col.length; row++) {
      if (col[row] === symbol) cells.push({ reel, row });
    }
  }
  return cells;
}

/** One lit line at a time. An empty list means the spin did not pay. */
export function lineWinCues(input: {
  grid: string[][];
  lineWins: LineWinInput[];
  scatterCount?: number;
  scatterMultiplier?: number;
  scatterSymbol?: string;
  wonProgressive?: boolean;
  progressiveLabel?: string;
  symbolLabel: (symbol: string) => string;
}): LineCue[] {
  const cues: LineCue[] = [];
  for (const win of input.lineWins) {
    const name = input.symbolLabel(win.symbol);
    cues.push({
      kind: "line",
      lineIndex: win.lineIndex,
      cells: win.cells,
      label: `${paylineDisplayName(win.lineIndex)}: ${name} ×${win.count} (${formatMult(win.multiplier)}×)`,
      ms: LINE_HOLD_MS,
    });
  }
  const scatterCount = input.scatterCount ?? 0;
  const scatterMultiplier = input.scatterMultiplier ?? 0;
  if (scatterCount >= 3 && scatterMultiplier > 0) {
    cues.push({
      kind: "line",
      lineIndex: null,
      cells: input.scatterSymbol ? cellsForSymbol(input.grid, input.scatterSymbol) : [],
      label: `Scatter ×${scatterCount} (${formatMult(scatterMultiplier)}×)`,
      ms: LINE_HOLD_MS,
    });
  }
  if (input.wonProgressive) {
    const center = PAYLINES[0] ?? [1, 1, 1, 1, 1];
    cues.push({
      kind: "line",
      lineIndex: 0,
      cells: center.map((row, reel) => ({ reel, row })),
      label: input.progressiveLabel ?? "Progressive jackpot!",
      ms: LINE_HOLD_MS,
    });
  }
  return cues;
}
