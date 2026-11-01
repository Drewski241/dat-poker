import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { utcDateKey } from "@dat-poker/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RitualPlayerState {
  lastFreerollUtcDay: string | null;
  streakDays: number;
  lastStreakUtcDay: string | null;
  freerollEntries: number;
  freerollItm: number;
  freerollWins: number;
}

export interface DailyRitualView {
  utcDay: string;
  freerollAvailable: boolean;
  freerollEnteredToday: boolean;
  streakDays: number;
  freerollEntries: number;
  freerollItm: number;
  freerollWins: number;
  /** Short badge label for the lobby. */
  badge: string | null;
}

const players = new Map<string, RitualPlayerState>();
let loaded = false;

function defaultPath(): string {
  return resolve(__dirname, "../../../data/ritual.json");
}

function ritualPath(): string | null {
  const raw = process.env.DAT_RITUAL_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return defaultPath();
}

function emptyState(): RitualPlayerState {
  return {
    lastFreerollUtcDay: null,
    streakDays: 0,
    lastStreakUtcDay: null,
    freerollEntries: 0,
    freerollItm: 0,
    freerollWins: 0,
  };
}

function persist(): void {
  const path = ritualPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(
    {
      players: [...players.entries()].map(([playerId, row]) => ({
        playerId,
        ...row,
      })),
    },
    null,
    2,
  );
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
}

export function loadRitual(): void {
  if (loaded) return;
  loaded = true;
  const path = ritualPath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      players?: Array<Partial<RitualPlayerState> & { playerId?: string }>;
    };
    for (const row of parsed.players ?? []) {
      if (!row.playerId) continue;
      players.set(row.playerId, {
        lastFreerollUtcDay: row.lastFreerollUtcDay ?? null,
        streakDays: Number(row.streakDays) || 0,
        lastStreakUtcDay: row.lastStreakUtcDay ?? null,
        freerollEntries: Number(row.freerollEntries) || 0,
        freerollItm: Number(row.freerollItm) || 0,
        freerollWins: Number(row.freerollWins) || 0,
      });
    }
  } catch {
    /* first run */
  }
}

export function resetRitualForTests(): void {
  players.clear();
  loaded = true;
}

function getOrCreate(playerId: string): RitualPlayerState {
  loadRitual();
  let row = players.get(playerId);
  if (!row) {
    row = emptyState();
    players.set(playerId, row);
  }
  return row;
}

function previousUtcDay(utcDay: string): string {
  const [y, m, d] = utcDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! - 1));
  return utcDateKey(dt);
}

function badgeFor(row: RitualPlayerState): string | null {
  if (row.freerollWins >= 5) return "Freeroll legend";
  if (row.freerollWins >= 1) return "Freeroll champ";
  if (row.streakDays >= 7) return "Week streak";
  if (row.streakDays >= 3) return `${row.streakDays}-day streak`;
  if (row.streakDays >= 1) return "Played today";
  return null;
}

export function getDailyRitual(playerId: string, now = new Date()): DailyRitualView {
  const row = getOrCreate(playerId);
  const utcDay = utcDateKey(now);
  const entered = row.lastFreerollUtcDay === utcDay;
  return {
    utcDay,
    freerollAvailable: !entered,
    freerollEnteredToday: entered,
    streakDays: row.streakDays,
    freerollEntries: row.freerollEntries,
    freerollItm: row.freerollItm,
    freerollWins: row.freerollWins,
    badge: badgeFor(row),
  };
}

/** Record a freeroll entry for today. Returns false if already entered. */
export function recordFreerollEntry(playerId: string, now = new Date()): boolean {
  const row = getOrCreate(playerId);
  const utcDay = utcDateKey(now);
  if (row.lastFreerollUtcDay === utcDay) return false;

  const prev = previousUtcDay(utcDay);
  if (row.lastStreakUtcDay === prev || row.lastFreerollUtcDay === prev) {
    row.streakDays = Math.max(1, row.streakDays) + 1;
  } else {
    row.streakDays = 1;
  }
  row.lastStreakUtcDay = utcDay;
  row.lastFreerollUtcDay = utcDay;
  row.freerollEntries += 1;
  persist();
  return true;
}

/**
 * Undo a freeroll entry recorded for `utcDay` when seating fails after the slot
 * was claimed. No-op if the player did not enter that day.
 */
export function releaseFreerollEntry(playerId: string, utcDay: string): void {
  const row = getOrCreate(playerId);
  if (row.lastFreerollUtcDay !== utcDay) return;
  row.lastFreerollUtcDay = null;
  row.freerollEntries = Math.max(0, row.freerollEntries - 1);
  if (row.lastStreakUtcDay === utcDay) {
    row.lastStreakUtcDay = previousUtcDay(utcDay);
    row.streakDays = Math.max(0, row.streakDays - 1);
    if (row.streakDays === 0) row.lastStreakUtcDay = null;
  }
  persist();
}

export function recordFreerollFinish(
  playerId: string,
  place: number,
): void {
  const row = getOrCreate(playerId);
  if (place >= 1 && place <= 3) {
    row.freerollItm += 1;
  }
  if (place === 1) {
    row.freerollWins += 1;
  }
  persist();
}
