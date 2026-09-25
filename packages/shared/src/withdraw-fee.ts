/** 1 XCH = 1_000_000_000_000 mojos. */
export const XCH_MOJOS_PER_COIN = 1_000_000_000_000n;

/**
 * Default treasury maker fee on `make_offer`.
 * 1_000_000 mojos = 0.000001 XCH. Sage Accept has no fee field, so the
 * treasury attaches this XCH when it builds the DAT gift offer.
 * Override with TREASURY_PAYOUT_FEE_MOJOS.
 */
export const DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS = 1_000_000n;

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

/** Player Accept fee. Unset or 0 stays 0 — treasury pays the maker fee. */
export function resolveSageTakeOfferFeeMojos(
  configured: string | bigint | number | undefined | null,
): bigint {
  return parseMojos(configured);
}

/** 0 or unset uses 0.000001 XCH so the DAT offer can be Accepted without a player fee box. */
export function resolveSageMakeOfferFeeMojos(
  configured: string | bigint | number | undefined | null,
): bigint {
  const parsed = parseMojos(configured);
  return parsed > 0n ? parsed : DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS;
}

export function formatXchMojos(mojos: bigint | string): string {
  const n = parseMojos(mojos);
  const whole = n / XCH_MOJOS_PER_COIN;
  const frac = n % XCH_MOJOS_PER_COIN;
  if (frac === 0n) return `${whole.toString()} XCH`;
  const fracStr = frac.toString().padStart(12, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr} XCH`;
}
