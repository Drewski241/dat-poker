/** 1 XCH = 1_000_000_000_000 mojos. */
export const XCH_MOJOS_PER_COIN = 1_000_000_000_000n;

/**
 * Default player-side fee for `chia_takeOffer`.
 * 1_000_000 mojos = 0.000001 XCH — enough for a quiet mainnet mempool.
 * Override with DAT_WITHDRAW_FEE_MOJOS.
 */
export const DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS = 1_000_000n;

export function parseMojos(value: string | bigint | number | undefined | null): bigint {
  if (typeof value === "bigint") return value >= 0n ? value : 0n;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? BigInt(Math.trunc(value)) : 0n;
  }
  const trimmed = value?.toString().trim() ?? "";
  if (!trimmed || !/^\d+$/.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

/** 0 or unset uses the default so Sage Accept is not submitted with a 0-XCH fee. */
export function resolveSageTakeOfferFeeMojos(
  configured: string | bigint | number | undefined | null,
): bigint {
  const parsed = parseMojos(configured);
  return parsed > 0n ? parsed : DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS;
}

export function formatXchMojos(mojos: bigint | string): string {
  const n = parseMojos(mojos);
  const whole = n / XCH_MOJOS_PER_COIN;
  const frac = n % XCH_MOJOS_PER_COIN;
  if (frac === 0n) return `${whole.toString()} XCH`;
  const fracStr = frac.toString().padStart(12, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr} XCH`;
}
