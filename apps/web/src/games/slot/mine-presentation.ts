import { PAYLINES } from "@dat-poker/slot-engine";
import { paylineDisplayName } from "./SlotPaylineOverlay.js";
import { symbolDisplay } from "./symbol-display.js";

/** Opening reels stop slowly enough to read the first board. */
export const MINE_STOP_MS = [1500, 1950, 2400, 2850, 3300] as const;
/** How long one winning line stays lit. */
export const MINE_LINE_MS = 2200;
/** Winning symbols shrink away before the refill. */
export const MINE_POP_MS = 480;
/** New and falling symbols settle into the next board. */
export const MINE_FALL_MS = 780;

export type MineCell = { reel: number; row: number };

export type MineLineWinView = {
  lineIndex: number;
  symbol: string;
  count: number;
  multiplier: number;
  cells: MineCell[];
};

export type MineCascadeFrame = {
  grid: string[][];
  multiplier: number;
  lineWins: MineLineWinView[];
  scatterCount: number;
  scatterMultiplier: number;
  scatterCells: MineCell[];
};

export type MineCue =
  | { kind: "spin"; grid: string[][]; stopMs: readonly number[]; banner: string }
  | {
      kind: "line";
      grid: string[][];
      lineIndex: number | null;
      cells: MineCell[];
      label: string;
      ms: number;
    }
  | {
      kind: "drop";
      grid: string[][];
      popCells: MineCell[];
      fallCells: MineCell[];
      label: string;
      popMs: number;
      fallMs: number;
    };

function asGrid(value: unknown): string[][] | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const cols: string[][] = [];
  for (const col of value) {
    if (!Array.isArray(col) || col.length !== 3) return null;
    cols.push(col.map((cell) => String(cell)));
  }
  return cols;
}

function asCells(value: unknown): MineCell[] {
  if (!Array.isArray(value)) return [];
  const cells: MineCell[] = [];
  for (const cell of value) {
    if (!cell || typeof cell !== "object") continue;
    const reel = (cell as { reel?: unknown }).reel;
    const row = (cell as { row?: unknown }).row;
    if (typeof reel === "number" && typeof row === "number") cells.push({ reel, row });
  }
  return cells;
}

function asLineWins(value: unknown): MineLineWinView[] {
  if (!Array.isArray(value)) return [];
  const wins: MineLineWinView[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const win = raw as Record<string, unknown>;
    if (typeof win.lineIndex !== "number" || typeof win.symbol !== "string") continue;
    if (typeof win.count !== "number" || typeof win.multiplier !== "number") continue;
    wins.push({
      lineIndex: win.lineIndex,
      symbol: win.symbol,
      count: win.count,
      multiplier: win.multiplier,
      cells: asCells(win.cells),
    });
  }
  return wins;
}

export function readMineCascades(meta: Record<string, unknown> | undefined): MineCascadeFrame[] {
  const raw = meta?.cascades;
  if (!Array.isArray(raw)) return [];
  const frames: MineCascadeFrame[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const frame = item as Record<string, unknown>;
    const grid = asGrid(frame.grid);
    if (!grid) continue;
    frames.push({
      grid,
      multiplier: typeof frame.multiplier === "number" ? frame.multiplier : 1,
      lineWins: asLineWins(frame.lineWins),
      scatterCount: typeof frame.scatterCount === "number" ? frame.scatterCount : 0,
      scatterMultiplier: typeof frame.scatterMultiplier === "number" ? frame.scatterMultiplier : 0,
      scatterCells: asCells(frame.scatterCells),
    });
  }
  return frames;
}

function formatMult(multiplier: number): string {
  const rounded = Math.round(multiplier * 100) / 100;
  return String(rounded);
}

function uniqueCells(cells: MineCell[]): MineCell[] {
  const seen = new Set<string>();
  const unique: MineCell[] = [];
  for (const cell of cells) {
    const key = `${cell.reel}-${cell.row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cell);
  }
  return unique;
}

/**
 * Cells that move when winning symbols are removed.
 * Row 0 is the top. Survivors fall toward the bottom and new symbols fill from the top.
 */
export function cellsThatFall(removed: MineCell[]): MineCell[] {
  const removedKey = new Set(removed.map((cell) => `${cell.reel}-${cell.row}`));
  const fall: MineCell[] = [];
  for (let reel = 0; reel < 5; reel++) {
    const survivors: number[] = [];
    for (let row = 0; row < 3; row++) {
      if (!removedKey.has(`${reel}-${row}`)) survivors.push(row);
    }
    const newCount = 3 - survivors.length;
    for (let row = 0; row < newCount; row++) fall.push({ reel, row });
    survivors.forEach((oldRow, index) => {
      const newRow = newCount + index;
      if (newRow !== oldRow) fall.push({ reel, row: newRow });
    });
  }
  return fall;
}

function lineLabel(frameIndex: number, frameCount: number, win: MineLineWinView): string {
  const name = symbolDisplay("mine-mojo", win.symbol).label;
  return `Cascade ${frameIndex + 1} of ${frameCount} · ${paylineDisplayName(win.lineIndex)}: ${name} ×${win.count} (${formatMult(win.multiplier)}×)`;
}

/** Ordered cues: slow stop, one lit line at a time, then the gems fall. */
export function mineTimeline(input: {
  meta?: Record<string, unknown>;
  finalGrid: string[][];
  wonProgressive?: boolean;
}): MineCue[] {
  const frames = readMineCascades(input.meta).filter(
    (frame) => frame.lineWins.length > 0 || frame.scatterMultiplier > 0,
  );
  if (frames.length === 0 && !input.wonProgressive) return [];

  const cues: MineCue[] = [];
  const opening = frames[0]?.grid ?? input.finalGrid;
  cues.push({
    kind: "spin",
    grid: opening,
    stopMs: MINE_STOP_MS,
    banner: "Spinning…",
  });

  frames.forEach((frame, index) => {
    for (const win of frame.lineWins) {
      cues.push({
        kind: "line",
        grid: frame.grid,
        lineIndex: win.lineIndex,
        cells: win.cells,
        label: lineLabel(index, frames.length, win),
        ms: MINE_LINE_MS,
      });
    }
    if (frame.scatterMultiplier > 0 && frame.scatterCount >= 3) {
      cues.push({
        kind: "line",
        grid: frame.grid,
        lineIndex: null,
        cells: frame.scatterCells,
        label: `Cascade ${index + 1} of ${frames.length} · Blast Charge ×${frame.scatterCount} (${formatMult(frame.scatterMultiplier)}×)`,
        ms: MINE_LINE_MS,
      });
    }
    const removed = uniqueCells(frame.lineWins.flatMap((win) => win.cells));
    if (removed.length === 0) return;
    const nextGrid = frames[index + 1]?.grid ?? input.finalGrid;
    cues.push({
      kind: "drop",
      grid: nextGrid,
      popCells: removed,
      fallCells: cellsThatFall(removed),
      label: "Winning gems clear",
      popMs: MINE_POP_MS,
      fallMs: MINE_FALL_MS,
    });
  });

  if (input.wonProgressive) {
    const center = PAYLINES[0] ?? [1, 1, 1, 1, 1];
    cues.push({
      kind: "line",
      grid: input.finalGrid,
      lineIndex: 0,
      cells: center.map((row, reel) => ({ reel, row })),
      label: "Progressive jackpot! · 5× Mother Lode on the center payline",
      ms: MINE_LINE_MS,
    });
  }

  return cues;
}
