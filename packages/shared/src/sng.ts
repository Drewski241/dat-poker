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
