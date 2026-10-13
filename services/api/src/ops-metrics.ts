import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isHousePlayerId } from "./house-id.js";

export type DropOffStreet = "preflop" | "flop" | "turn" | "river" | "showdown" | "unknown";

export interface DayBucket {
  /** UTC date YYYY-MM-DD */
  day: string;
  activePlayers: Set<string>;
  handsCompleted: number;
  dropOff: Record<DropOffStreet, number>;
}

export interface OpsMetricsSnapshot {
  day: string;
  dau: number;
  handsCompleted: number;
  handsPerActivePlayer: number;
  dropOffStreet: Record<DropOffStreet, number>;
  /** Rolling window of recent UTC days (newest first). */
  recentDays: Array<{
    day: string;
    dau: number;
    handsCompleted: number;
    handsPerActivePlayer: number;
    dropOffStreet: Record<DropOffStreet, number>;
  }>;
}

const MAX_DAYS = 14;
const buckets = new Map<string, DayBucket>();

function emptyDropOff(): Record<DropOffStreet, number> {
  return {
    preflop: 0,
    flop: 0,
    turn: 0,
    river: 0,
    showdown: 0,
    unknown: 0,
  };
}

export function utcDayKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function streetFromHand(reason: "fold" | "showdown", boardLen: number): DropOffStreet {
  if (reason === "showdown") return "showdown";
  if (boardLen <= 0) return "preflop";
  if (boardLen === 3) return "flop";
  if (boardLen === 4) return "turn";
  if (boardLen >= 5) return "river";
  return "unknown";
}

function ensureDay(day: string): DayBucket {
  let b = buckets.get(day);
  if (!b) {
    b = { day, activePlayers: new Set(), handsCompleted: 0, dropOff: emptyDropOff() };
    buckets.set(day, b);
    pruneOldDays();
  }
  return b;
}

function pruneOldDays(): void {
  if (buckets.size <= MAX_DAYS) return;
  const keys = [...buckets.keys()].sort();
  while (keys.length > MAX_DAYS) {
    const old = keys.shift();
    if (old) buckets.delete(old);
  }
}

function metricsLogPath(): string | null {
  const raw = process.env.DAT_OPS_METRICS_PATH?.trim();
  if (!raw || raw === "off" || raw === "memory") return null;
  return resolve(raw);
}

async function appendMetricsLog(event: Record<string, unknown>): Promise<void> {
  const path = metricsLogPath();
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error("[ops-metrics] failed to append log", err);
  }
}

/** Count a human as active for DAU (house bots ignored). */
export function recordActivePlayer(playerId: string, nowMs = Date.now()): void {
  if (!playerId || isHousePlayerId(playerId)) return;
  const day = utcDayKey(nowMs);
  ensureDay(day).activePlayers.add(playerId);
  void appendMetricsLog({ type: "active", day, atMs: nowMs });
}

export function recordHandCompleted(params: {
  reason: "fold" | "showdown";
  boardLen: number;
  participantIds: string[];
  nowMs?: number;
}): void {
  const nowMs = params.nowMs ?? Date.now();
  const day = utcDayKey(nowMs);
  const bucket = ensureDay(day);
  bucket.handsCompleted += 1;
  const street = streetFromHand(params.reason, params.boardLen);
  bucket.dropOff[street] += 1;
  for (const id of params.participantIds) {
    if (!id || isHousePlayerId(id)) continue;
    bucket.activePlayers.add(id);
  }
  void appendMetricsLog({
    type: "hand",
    day,
    atMs: nowMs,
    reason: params.reason,
    boardLen: params.boardLen,
    street,
    humans: params.participantIds.filter((id) => id && !isHousePlayerId(id)).length,
  });
}

function snapshotDay(b: DayBucket) {
  const dau = b.activePlayers.size;
  return {
    day: b.day,
    dau,
    handsCompleted: b.handsCompleted,
    handsPerActivePlayer: dau > 0 ? Math.round((b.handsCompleted / dau) * 100) / 100 : 0,
    dropOffStreet: { ...b.dropOff },
  };
}

export function getOpsMetricsSnapshot(nowMs = Date.now()): OpsMetricsSnapshot {
  const day = utcDayKey(nowMs);
  const today = ensureDay(day);
  const recentDays = [...buckets.values()]
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .map(snapshotDay);
  return {
    ...snapshotDay(today),
    recentDays,
  };
}

export function resetOpsMetricsForTests(): void {
  buckets.clear();
}
