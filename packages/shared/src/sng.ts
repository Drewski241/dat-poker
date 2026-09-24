import { DAT_TABLE_DEFAULTS } from "./dat-units.js";

export const HOUSE_PLAYER_ID = "dat-poker:house";
export const HOUSE_PLAYER_PREFIX = "dat-poker:house:";

export function isHousePlayerId(playerId: string): boolean {
  return playerId === HOUSE_PLAYER_ID || playerId.startsWith(HOUSE_PLAYER_PREFIX);
}

export function houseSeatPlayerId(seatIndex: number): string {
  return `${HOUSE_PLAYER_PREFIX}${seatIndex}`;
}

export type SngStatus = "registering" | "running" | "finished";
export type HousePolicy = "passive" | "folding" | "mixed";

export interface SngBlindLevel {
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
}

export interface SngPayoutShare {
  place: number;
  bps: number;
}

export interface SngPlacement {
  playerId: string;
  place: number;
  prizeMojos: bigint;
}

/** 9-max NLHE SNG defaults (DAT CAT mojos). */
export const DAT_SNG_DEFAULTS = {
  maxSeats: 9,
  buyInMojos: DAT_TABLE_DEFAULTS.minBuyInMojos,
  startingStackMojos: DAT_TABLE_DEFAULTS.minBuyInMojos,
  handsPerLevel: 4,
  /** Blind clock: next level after this many ms, applied between hands. */
  levelDurationMs: 3 * 60 * 1000,
  fillHouse: true,
  minHumansToStart: 1,
  housePolicy: "mixed" as HousePolicy,
  blindLevels: [
    { smallBlindMojos: 10_000n, bigBlindMojos: 20_000n },
    { smallBlindMojos: 15_000n, bigBlindMojos: 30_000n },
    { smallBlindMojos: 25_000n, bigBlindMojos: 50_000n },
    { smallBlindMojos: 50_000n, bigBlindMojos: 100_000n },
    { smallBlindMojos: 75_000n, bigBlindMojos: 150_000n },
    { smallBlindMojos: 100_000n, bigBlindMojos: 200_000n },
    { smallBlindMojos: 150_000n, bigBlindMojos: 300_000n },
    { smallBlindMojos: 250_000n, bigBlindMojos: 500_000n },
    { smallBlindMojos: 500_000n, bigBlindMojos: 1_000_000n },
  ] satisfies SngBlindLevel[],
} as const;

/** 9-max: 50 / 30 / 20. Three-handed tests use the same table so 2nd/3rd still pay. */
export function defaultSngPayouts(maxSeats: number): SngPayoutShare[] {
  if (maxSeats < 3) {
    return [{ place: 1, bps: 10_000 }];
  }
  return [
    { place: 1, bps: 5_000 },
    { place: 2, bps: 3_000 },
    { place: 3, bps: 2_000 },
  ];
}

/**
 * 1st / 2nd / 3rd of the whole table get 50/30/20.
 * House seats in the money are not paid, and that share is not moved to a lower human.
 */
export function assignSngItmPrizes(
  placements: SngPlacement[],
  prizePoolMojos: bigint,
  payouts: SngPayoutShare[] = defaultSngPayouts(9),
): SngPlacement[] {
  const prizes = sngPrizes(prizePoolMojos, payouts);
  return placements.map((row) => {
    if (isHousePlayerId(row.playerId)) {
      return { ...row, prizeMojos: 0n };
    }
    return { ...row, prizeMojos: prizes.get(row.place) ?? 0n };
  });
}

export function sngPrizes(prizePoolMojos: bigint, payouts: SngPayoutShare[]): Map<number, bigint> {
  const prizes = new Map<number, bigint>();
  let allocated = 0n;
  const paid = [...payouts].sort((a, b) => a.place - b.place);
  for (const row of paid) {
    const amount = (prizePoolMojos * BigInt(row.bps)) / 10_000n;
    prizes.set(row.place, amount);
    allocated += amount;
  }
  if (prizes.size > 0) {
    const first = paid[0].place;
    prizes.set(first, (prizes.get(first) ?? 0n) + (prizePoolMojos - allocated));
  }
  return prizes;
}

/** Level index from elapsed clock time and/or hands played (whichever is further). */
export function sngTargetBlindLevel(input: {
  nowMs: number;
  startedAtMs: number | null;
  handNumber: number;
  levelDurationMs: number;
  handsPerLevel: number;
  levelCount: number;
}): number {
  if (input.levelCount <= 1) return 0;
  const last = input.levelCount - 1;
  const elapsed = input.startedAtMs == null ? 0 : Math.max(0, input.nowMs - input.startedAtMs);
  const timeLevel =
    input.levelDurationMs <= 0 ? 0 : Math.floor(elapsed / input.levelDurationMs);
  const handLevel =
    input.handNumber <= 0 || input.handsPerLevel <= 0
      ? 0
      : Math.floor((input.handNumber - 1) / input.handsPerLevel);
  return Math.min(last, Math.max(timeLevel, handLevel));
}

export function sngNextLevelAtMs(input: {
  startedAtMs: number | null;
  levelIndex: number;
  levelDurationMs: number;
  levelCount: number;
}): number | null {
  if (input.startedAtMs == null || input.levelDurationMs <= 0) return null;
  if (input.levelIndex >= input.levelCount - 1) return null;
  return input.startedAtMs + (input.levelIndex + 1) * input.levelDurationMs;
}

export function sngHandsUntilNextLevel(input: {
  handNumber: number;
  levelIndex: number;
  handsPerLevel: number;
  levelCount: number;
}): number | null {
  if (input.levelIndex >= input.levelCount - 1 || input.handsPerLevel <= 0) return null;
  const nextHandTrigger = (input.levelIndex + 1) * input.handsPerLevel + 1;
  return Math.max(1, nextHandTrigger - input.handNumber);
}
