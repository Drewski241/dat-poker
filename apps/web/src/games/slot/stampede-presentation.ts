import { symbolDisplay } from "./symbol-display.js";

export type StampedeCell = { reel: number; row: number };

export type StampedeWayView = {
  symbol: string;
  reelCount: number;
  ways: number;
  multiplier: number;
  phase?: string;
  cells?: StampedeCell[];
};

export type StampedeBeat = {
  label: string;
  cells: StampedeCell[];
};

export type StampedeShow = {
  expanding: boolean;
  openingGrid: string[][] | null;
  openingBeats: StampedeBeat[];
  respinBeats: StampedeBeat[];
};

/** Opening reels stop slowly enough to read the first board. */
export const STAMPEDE_STOP_MS = [1500, 1950, 2400, 2850, 3300] as const;
/** Respin leaves reel 3 (index 2) locked on the expanded Dust Wild. */
export const STAMPEDE_RESPIN_STOP_MS = [1300, 1800, 0, 2300, 2800] as const;
export const WIN_BEAT_MS = 2200;
export const EXPAND_HOLD_MS = 1800;

const EXPAND_CELLS: StampedeCell[] = [
  { reel: 2, row: 0 },
  { reel: 2, row: 1 },
  { reel: 2, row: 2 },
];

export type StampedeCue =
  | {
      kind: "spin";
      grid: string[][];
      stopMs: readonly number[];
      lockedReels: number[];
      banner: string;
    }
  | { kind: "beat"; label: string; cells: StampedeCell[]; ms: number }
  | { kind: "expand"; banner: string; cells: StampedeCell[]; ms: number };

function asGrid(value: unknown): string[][] | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const cols: string[][] = [];
  for (const col of value) {
    if (!Array.isArray(col) || col.length !== 3) return null;
    cols.push(col.map((cell) => String(cell)));
  }
  return cols;
}

function asCells(value: unknown): StampedeCell[] {
  if (!Array.isArray(value)) return [];
  const cells: StampedeCell[] = [];
  for (const cell of value) {
    if (!cell || typeof cell !== "object") continue;
    const reel = (cell as { reel?: unknown }).reel;
    const row = (cell as { row?: unknown }).row;
    if (typeof reel === "number" && typeof row === "number") cells.push({ reel, row });
  }
  return cells;
}

function wayLabel(way: StampedeWayView): string {
  const name = symbolDisplay("spirit-stampede", way.symbol).label;
  const wayWord = way.ways === 1 ? "way" : "ways";
  return `${name} ${way.reelCount}-reel · ${way.ways} ${wayWord} (${way.multiplier}×)`;
}

function beatsFor(ways: StampedeWayView[], intro: string): StampedeBeat[] {
  return ways.map((way) => ({
    label: `${intro}${wayLabel(way)}`,
    cells: way.cells ?? [],
  }));
}

function dustCells(grid: string[][]): StampedeCell[] {
  const cells: StampedeCell[] = [];
  for (let reel = 0; reel < grid.length; reel++) {
    const col = grid[reel] ?? [];
    for (let row = 0; row < col.length; row++) {
      if (col[row] === "dust") cells.push({ reel, row });
    }
  }
  return cells;
}

function beatCues(beats: StampedeBeat[]): StampedeCue[] {
  return beats.map((beat) => ({ kind: "beat", label: beat.label, cells: beat.cells, ms: WIN_BEAT_MS }));
}

/** Split a Stampede result into the boards and win beats the player should see. */
export function readStampedeShow(input: {
  waysWins?: StampedeWayView[];
  meta?: Record<string, unknown>;
  scatterCount?: number;
  scatterMultiplier?: number;
}): StampedeShow {
  const meta = input.meta ?? {};
  const expanding = meta.expandingWild === true;
  const openingGrid = expanding ? asGrid(meta.preRespinGrid) : null;
  const showExpanding = expanding && openingGrid != null;
  const ways = input.waysWins ?? [];
  const tagged = ways.some((way) => way.phase === "base" || way.phase === "respin");
  const openingWays = !showExpanding
    ? ways
    : tagged
      ? ways.filter((way) => way.phase !== "respin")
      : [];
  const respinWays = !showExpanding ? [] : tagged ? ways.filter((way) => way.phase === "respin") : ways;
  const openingBeats = beatsFor(openingWays, showExpanding ? "Opening spin · " : "");
  const respinBeats = beatsFor(respinWays, "Respin · ");
  const baseScatter = meta.baseScatterCount;
  if (showExpanding && typeof baseScatter === "number" && baseScatter >= 3) {
    openingBeats.push({
      label: `Opening spin · Moon scatter ×${baseScatter}`,
      cells: asCells(meta.baseScatterCells),
    });
  }
  const scatterPays = (input.scatterCount ?? 0) >= 3 && (input.scatterMultiplier ?? 0) > 0;
  if (scatterPays) {
    const beat: StampedeBeat = {
      label: `${showExpanding ? "Respin · " : ""}Moon scatter ×${input.scatterCount}`,
      cells: asCells(meta.scatterCells),
    };
    if (showExpanding) respinBeats.push(beat);
    else openingBeats.push(beat);
  }
  return {
    expanding: showExpanding,
    openingGrid,
    openingBeats,
    respinBeats,
  };
}

/** Ordered cues: slow stop, one lit win at a time, then the expand and respin. */
export function stampedeTimeline(input: {
  show: StampedeShow;
  finalGrid: string[][];
  wonProgressive?: boolean;
}): StampedeCue[] {
  const cues: StampedeCue[] = [];
  const { show } = input;
  const jackpot: StampedeBeat[] = input.wonProgressive
    ? [{ label: "Progressive jackpot!", cells: dustCells(input.finalGrid) }]
    : [];
  if (show.expanding && show.openingGrid) {
    cues.push({
      kind: "spin",
      grid: show.openingGrid,
      stopMs: STAMPEDE_STOP_MS,
      lockedReels: [],
      banner: "Spinning…",
    });
    cues.push(...beatCues(show.openingBeats));
    cues.push({
      kind: "expand",
      banner: "Dust Wild expands across reel 3",
      cells: EXPAND_CELLS,
      ms: EXPAND_HOLD_MS,
    });
    cues.push({
      kind: "spin",
      grid: input.finalGrid,
      stopMs: STAMPEDE_RESPIN_STOP_MS,
      lockedReels: [2],
      banner: "Respinning…",
    });
    cues.push(...beatCues([...show.respinBeats, ...jackpot]));
    return cues;
  }
  cues.push({
    kind: "spin",
    grid: input.finalGrid,
    stopMs: STAMPEDE_STOP_MS,
    lockedReels: [],
    banner: "Spinning…",
  });
  cues.push(...beatCues([...show.openingBeats, ...jackpot]));
  return cues;
}
