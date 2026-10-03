/**
 * Standard tournament prize ladders and prize-pool accounting.
 *
 * Places paid scale with field size; percentages sum to 1 and are applied to
 * the total prize pool (buy-ins − fees + re-entries).
 */

export interface PayoutPlace {
  place: number;
  /** Fraction of prize pool (sum ≈ 1 across ladder). */
  pct: number;
  amountMojos: bigint;
}

export interface PrizePoolBreakdown {
  entries: number;
  buyInMojos: bigint;
  feeBps: number;
  grossMojos: bigint;
  feesMojos: bigint;
  prizePoolMojos: bigint;
  paidPlaces: number;
  ladder: PayoutPlace[];
}

/** Fee in basis points taken from each entry before the prize pool (e.g. 500 = 5%). */
export function entryNetToPool(buyInMojos: bigint, feeBps: number): {
  toPool: bigint;
  fee: bigint;
} {
  if (feeBps < 0 || feeBps > 10_000) {
    throw new Error("feeBps must be 0..10000");
  }
  const fee = (buyInMojos * BigInt(feeBps)) / 10_000n;
  return { toPool: buyInMojos - fee, fee };
}

/**
 * How many places are paid for a given field size.
 * Rough industry heuristic: ~10–15% of the field, min 2 when ≥2 runners.
 */
export function paidPlacesForField(entries: number): number {
  if (entries <= 1) return entries;
  if (entries <= 3) return entries;
  if (entries <= 6) return 2;
  if (entries <= 9) return 3;
  if (entries <= 18) return 4;
  if (entries <= 27) return 5;
  if (entries <= 45) return 7;
  if (entries <= 90) return 12;
  if (entries <= 180) return 18;
  if (entries <= 450) return 45;
  if (entries <= 900) return 90;
  // ~10% of field, rounded to a multiple of 5, capped reasonably
  const raw = Math.floor(entries * 0.1);
  return Math.max(100, Math.floor(raw / 5) * 5);
}

/**
 * Percentage weights for N paid places (largest share to 1st).
 * Uses a geometric decay so early places dominate but deep runs still pay.
 */
export function payoutPercentages(paidPlaces: number): number[] {
  if (paidPlaces <= 0) return [];
  if (paidPlaces === 1) return [1];
  if (paidPlaces === 2) return [0.65, 0.35];
  if (paidPlaces === 3) return [0.5, 0.3, 0.2];

  const weights: number[] = [];
  let w = 1;
  for (let i = 0; i < paidPlaces; i++) {
    weights.push(w);
    w *= 0.62;
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((x) => x / sum);
}

function distributePool(pool: bigint, pcts: number[]): bigint[] {
  if (pcts.length === 0) return [];
  const amounts: bigint[] = [];
  let allocated = 0n;
  for (let i = 0; i < pcts.length; i++) {
    if (i === pcts.length - 1) {
      amounts.push(pool - allocated);
    } else {
      const amt = BigInt(Math.floor(Number(pool) * pcts[i]!));
      amounts.push(amt);
      allocated += amt;
    }
  }
  // Fix negative last due to float — rare with large pools
  if (amounts[amounts.length - 1]! < 0n) {
    amounts[amounts.length - 1] = 0n;
  }
  return amounts;
}

export function buildPrizePool(input: {
  entries: number;
  buyInMojos: bigint;
  feeBps?: number;
  /** Override paid places; default from field size. */
  paidPlaces?: number;
}): PrizePoolBreakdown {
  const feeBps = input.feeBps ?? 0;
  const { toPool, fee } = entryNetToPool(input.buyInMojos, feeBps);
  const grossMojos = input.buyInMojos * BigInt(input.entries);
  const feesMojos = fee * BigInt(input.entries);
  const prizePoolMojos = toPool * BigInt(input.entries);
  const paidPlaces = input.paidPlaces ?? paidPlacesForField(input.entries);
  const pcts = payoutPercentages(Math.min(paidPlaces, Math.max(1, input.entries)));
  const amounts = distributePool(prizePoolMojos, pcts);
  const ladder: PayoutPlace[] = amounts.map((amountMojos, i) => ({
    place: i + 1,
    pct: pcts[i]!,
    amountMojos,
  }));

  return {
    entries: input.entries,
    buyInMojos: input.buyInMojos,
    feeBps,
    grossMojos,
    feesMojos,
    prizePoolMojos,
    paidPlaces: ladder.length,
    ladder,
  };
}

/** Look up cash prize for a finish position (1 = winner). */
export function prizeForPlace(
  ladder: readonly PayoutPlace[],
  finishPosition: number,
): bigint {
  const row = ladder.find((p) => p.place === finishPosition);
  return row?.amountMojos ?? 0n;
}
