/** Chia CAT tokens use 1000 mojos per whole token (not XCH's 10^12). */
export const CAT_MOJOS_PER_TOKEN = 1000n;

export function formatDatMojos(mojos: bigint | string, ticker = "DAT"): string {
  const n = typeof mojos === "string" ? BigInt(mojos) : mojos;
  const whole = n / CAT_MOJOS_PER_TOKEN;
  const frac = n % CAT_MOJOS_PER_TOKEN;
  if (frac === 0n) return `${whole} ${ticker}`;
  const fracStr = frac.toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole}.${fracStr} ${ticker}`;
}

export function datTokensToMojos(tokens: bigint | number | string): bigint {
  return BigInt(tokens) * CAT_MOJOS_PER_TOKEN;
}

/** Default NLHE table stakes when buy-ins are DAT CAT mojos. */
export const DAT_TABLE_DEFAULTS = {
  minBuyInMojos: 1_000_000n, // 1,000 DAT
  maxBuyInMojos: 50_000_000n, // 50,000 DAT
  smallBlindMojos: 5_000n, // 5 DAT
  bigBlindMojos: 10_000n, // 10 DAT
} as const;

/** Legacy XCH-style table minimum (10^12 mojos) — not valid for DAT CAT buy-ins. */
export const XCH_LEGACY_MIN_BUY_IN_MOJOS = 2_000_000_000_000n;

/**
 * Resolve DAT min buy-in from env. CAT mojos use 1000 per whole DAT token.
 * Rejects legacy XCH-scale values (>= 10^12) that were mistakenly copied into .env.
 */
export function resolveDatMinBuyInMojos(raw: string | undefined): bigint {
  if (!raw?.trim()) {
    return DAT_TABLE_DEFAULTS.minBuyInMojos;
  }
  const value = BigInt(raw.trim());
  if (value >= 1_000_000_000_000n) {
    return DAT_TABLE_DEFAULTS.minBuyInMojos;
  }
  return value;
}
