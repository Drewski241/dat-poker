/** 1 XCH = 1_000_000_000_000 mojos. */
export const XCH_MOJOS_PER_COIN = 1_000_000_000_000n;

/**
 * Chia mainnet dust-storm mempool floor: 0.09 mojo per cost unit.
 * Fee = ceil(cost × 0.09). A 1_000_000 mojo fee only covers ~11M cost and
 * is evicted; CAT offer/cancel spends are typically 50–100M cost.
 */
export const CHIA_DUST_STORM_FEE_MOJOS_PER_COST = 0.09;

/** Conservative CAT offer / cancel cost used when Sage does not report CLVM cost. */
export const SAGE_CAT_SPEND_COST_UNITS = 100_000_000n;

/**
 * Default treasury maker + cancel fee: ceil(100_000_000 × 0.09) = 9_000_000 mojos
 * (0.000009 XCH). Sage Accept has no fee field, so treasury attaches this XCH
 * on `make_offer` and on-chain `cancel_offer` / `cancel_offers`.
 * Override with TREASURY_PAYOUT_FEE_MOJOS (values below this floor are raised).
 */
export const DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS = 9_000_000n;

/** Player `chia_takeOffer` fee. Sage Accept has no fee box — default 0. */
export const DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS = 0n;

export function parseMojos(value: string | bigint | number | undefined | null): bigint {
  if (typeof value === "bigint") return value >= 0n ? value : 0n;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? BigInt(Math.trunc(value)) : 0n;
  }
  const trimmed = value?.toString().trim() ?? "";
  if (!trimmed || !/^\d+$/.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

/** ceil(cost × 0.09) so a CAT spend is included in the dust-storm mempool. */
export function chiaDustStormFeeMojos(
  costUnits: bigint | number = SAGE_CAT_SPEND_COST_UNITS,
): bigint {
  const cost =
    typeof costUnits === "bigint" ? costUnits : BigInt(Number.isFinite(costUnits) ? Math.trunc(costUnits) : 0);
  if (cost <= 0n) return DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS;
  return (cost * 9n + 99n) / 100n;
}

/** Player Accept fee. Unset or 0 stays 0 — treasury pays the maker fee. */
export function resolveSageTakeOfferFeeMojos(
  configured: string | bigint | number | undefined | null,
): bigint {
  return parseMojos(configured);
}

/**
 * 0 or unset uses the dust-storm CAT fee. A configured value below that
 * floor (including the old 1_000_000 default) is raised so leftover cancels
 * are not evicted from the mempool.
 */
export function resolveSageMakeOfferFeeMojos(
  configured: string | bigint | number | undefined | null,
): bigint {
  const parsed = parseMojos(configured);
  const dustStormMin = chiaDustStormFeeMojos();
  return parsed > dustStormMin ? parsed : dustStormMin;
}

/** Batch cancel cost scales with leftover offer count (one CAT spend each). */
export function resolveSageCancelFeeMojos(
  configured: string | bigint | number | undefined | null,
  offerCount = 1,
): bigint {
  const parsed = resolveSageMakeOfferFeeMojos(configured);
  const n = offerCount > 0 ? BigInt(offerCount) : 1n;
  const batchMin = chiaDustStormFeeMojos(SAGE_CAT_SPEND_COST_UNITS * n);
  return parsed > batchMin ? parsed : batchMin;
}

export function formatXchMojos(mojos: bigint | string): string {
  const n = parseMojos(mojos);
  const whole = n / XCH_MOJOS_PER_COIN;
  const frac = n % XCH_MOJOS_PER_COIN;
  if (frac === 0n) return `${whole.toString()} XCH`;
  const fracStr = frac.toString().padStart(12, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr} XCH`;
}
