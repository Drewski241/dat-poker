export const DEV_AUTHORIZER_PUBLIC_KEY = "02".repeat(48);

export interface SiteRedeemConfig {
  enabled: boolean;
  maxMojos: bigint;
  capMojos: bigint;
}

function readMojos(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  return BigInt(raw);
}

export function readSiteRedeemConfig(): SiteRedeemConfig {
  return {
    enabled: process.env.DAT_ALLOW_SITE_REDEEM === "true",
    maxMojos: readMojos("DAT_SITE_REDEEM_MAX_MOJOS", 100_000n),
    capMojos: readMojos("DAT_SITE_REDEEM_CAP_MOJOS", 1_000_000n),
  };
}

/** 96 hex chars. Dev buy-in uses a non-production key so local tournaments still curry. */
export function readAuthorizerPublicKey(): string | null {
  const raw = process.env.TOURNAMENT_AUTHORIZER_PUBLIC_KEY?.trim().toLowerCase().replace(/^0x/, "");
  if (raw && /^[0-9a-f]{96}$/.test(raw)) return raw;
  if (process.env.DAT_ALLOW_DEV_BUYIN === "true") return DEV_AUTHORIZER_PUBLIC_KEY;
  return null;
}

export function readCatModHash(): string {
  const raw = process.env.DAT_CAT_MOD_HASH?.trim().toLowerCase().replace(/^0x/, "");
  if (raw && /^[0-9a-f]{64}$/.test(raw)) return raw;
  return "37bef360ee858133b69d595a906dc45d01af50379dad515eb9518abb7c1d2a7a";
}
