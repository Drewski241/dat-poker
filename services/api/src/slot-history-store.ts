import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlotGameId } from "@dat-poker/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Newest spins kept for one player on one machine. */
const HISTORY_LIMIT = 40;

export type SlotHistoryWin = {
  lineIndex: number;
  symbol: string;
  count: number;
  multiplier: number;
};

export type SlotHistoryWay = {
  symbol: string;
  reelCount: number;
  ways: number;
  multiplier: number;
  phase?: string;
};

export type SlotHistoryEntry = {
  id: string;
  at: string;
  gameId: SlotGameId;
  betMojos: string;
  lineWinMojos: string;
  progressiveWinMojos: string;
  netMojos: string;
  wonProgressive: boolean;
  freeSpin: boolean;
  drawPhase: boolean;
  lineWins: SlotHistoryWin[];
  waysWins: SlotHistoryWay[];
  scatterCount: number;
  scatterMultiplier: number;
  cascadeSteps: number;
  expandingWild: boolean;
};

type HistoryFile = Record<string, Partial<Record<SlotGameId, SlotHistoryEntry[]>>>;

const byPlayer = new Map<string, Partial<Record<SlotGameId, SlotHistoryEntry[]>>>();
let loaded = false;

function historyPath(): string | null {
  const raw = process.env.DAT_SLOT_HISTORY_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return resolve(__dirname, "../../../data/slot-history.json");
}

function persist(): void {
  const path = historyPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const body: HistoryFile = {};
  for (const [playerId, games] of byPlayer) body[playerId] = games;
  writeFileSync(path, JSON.stringify(body), { encoding: "utf8", mode: 0o600 });
}

function asWins(value: unknown): SlotHistoryWin[] {
  if (!Array.isArray(value)) return [];
  const wins: SlotHistoryWin[] = [];
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
    });
  }
  return wins;
}

function asWays(value: unknown): SlotHistoryWay[] {
  if (!Array.isArray(value)) return [];
  const ways: SlotHistoryWay[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const way = raw as Record<string, unknown>;
    if (typeof way.symbol !== "string" || typeof way.reelCount !== "number") continue;
    if (typeof way.ways !== "number" || typeof way.multiplier !== "number") continue;
    ways.push({
      symbol: way.symbol,
      reelCount: way.reelCount,
      ways: way.ways,
      multiplier: way.multiplier,
      phase: typeof way.phase === "string" ? way.phase : undefined,
    });
  }
  return ways;
}

function asEntry(value: unknown): SlotHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.at !== "string" || typeof row.gameId !== "string") return null;
  if (typeof row.betMojos !== "string" || typeof row.netMojos !== "string") return null;
  return {
    id: row.id,
    at: row.at,
    gameId: row.gameId as SlotGameId,
    betMojos: row.betMojos,
    lineWinMojos: typeof row.lineWinMojos === "string" ? row.lineWinMojos : "0",
    progressiveWinMojos: typeof row.progressiveWinMojos === "string" ? row.progressiveWinMojos : "0",
    netMojos: row.netMojos,
    wonProgressive: row.wonProgressive === true,
    freeSpin: row.freeSpin === true,
    drawPhase: row.drawPhase === true,
    lineWins: asWins(row.lineWins),
    waysWins: asWays(row.waysWins),
    scatterCount: typeof row.scatterCount === "number" ? row.scatterCount : 0,
    scatterMultiplier: typeof row.scatterMultiplier === "number" ? row.scatterMultiplier : 0,
    cascadeSteps: typeof row.cascadeSteps === "number" ? row.cascadeSteps : 0,
    expandingWild: row.expandingWild === true,
  };
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const path = historyPath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as HistoryFile;
    for (const [playerId, games] of Object.entries(parsed)) {
      const kept: Partial<Record<SlotGameId, SlotHistoryEntry[]>> = {};
      if (games && typeof games === "object") {
        for (const [gameId, rows] of Object.entries(games)) {
          if (!Array.isArray(rows)) continue;
          kept[gameId as SlotGameId] = rows.map(asEntry).filter((row): row is SlotHistoryEntry => row != null);
        }
      }
      byPlayer.set(playerId, kept);
    }
  } catch {
    /* empty file */
  }
}

export function recordSlotSpin(
  playerId: string,
  spin: Omit<SlotHistoryEntry, "id" | "at">,
): SlotHistoryEntry {
  load();
  const entry: SlotHistoryEntry = {
    ...spin,
    id: randomUUID(),
    at: new Date().toISOString(),
  };
  const games = byPlayer.get(playerId) ?? {};
  const rows = games[spin.gameId] ?? [];
  games[spin.gameId] = [entry, ...rows].slice(0, HISTORY_LIMIT);
  byPlayer.set(playerId, games);
  persist();
  return entry;
}

export function listSlotHistory(playerId: string, gameId: SlotGameId): SlotHistoryEntry[] {
  load();
  return (byPlayer.get(playerId)?.[gameId] ?? []).map((row) => ({ ...row }));
}

export function resetSlotHistoryForTests(): void {
  loaded = false;
  byPlayer.clear();
}
