import {
  createTreasuryCatPayoutOffer,
  describeMissingSageCerts,
  readTreasuryWalletRpcConfigFromEnv,
  type TreasuryWalletRpcConfig,
} from "@dat-poker/chia-bridge";

export type TreasuryOfferMode = "rpc" | "mock";

export interface TreasuryServiceConfig {
  port: number;
  host: string;
  offerMode: TreasuryOfferMode;
  defaultAssetId: string | null;
  payoutFeeMojos: bigint;
  treasuryAddress: string | null;
  walletRpc: TreasuryWalletRpcConfig;
}

export function readTreasuryServiceConfig(): TreasuryServiceConfig {
  const offerMode = process.env.TREASURY_OFFER_MODE === "mock" ? "mock" : "rpc";
  return {
    port: Number(process.env.TREASURY_PORT ?? 4200),
    host: process.env.TREASURY_HOST ?? "0.0.0.0",
    offerMode,
    defaultAssetId: process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID?.trim() || null,
    payoutFeeMojos: BigInt(process.env.TREASURY_PAYOUT_FEE_MOJOS ?? "0"),
    treasuryAddress: process.env.TREASURY_XCH_ADDRESS?.trim() || null,
    walletRpc: readTreasuryWalletRpcConfigFromEnv(),
  };
}

export interface PayoutRequestBody {
  assetId?: string;
  address: string;
  amountMojos: string;
}

export async function buildPayoutOffer(
  config: TreasuryServiceConfig,
  body: PayoutRequestBody,
): Promise<{ offer: string; mode: TreasuryOfferMode }> {
  const assetId = body.assetId ?? config.defaultAssetId;
  if (!assetId) {
    throw new Error("assetId required (set DAT_GOVERNANCE_TOKEN_ASSET_ID or pass in request)");
  }
  if (!body.address?.trim()) {
    throw new Error("address required");
  }
  if (
    config.treasuryAddress &&
    config.treasuryAddress.toLowerCase() === body.address.trim().toLowerCase()
  ) {
    throw new Error(
      "Payout address is the treasury Sage wallet. Use a separate player Sage key — a self-payout cannot show as a new deposit.",
    );
  }
  const amountMojos = BigInt(body.amountMojos);
  if (amountMojos <= 0n) {
    throw new Error("amountMojos must be positive");
  }

  if (config.offerMode === "mock") {
    return {
      mode: "mock",
      offer: `mock-offer:${assetId}:${body.address}:${amountMojos.toString()}`,
    };
  }

  const hasCerts = Boolean(config.walletRpc.certPath && config.walletRpc.keyPath);
  if (!hasCerts) {
    throw new Error(describeMissingSageCerts());
  }

  const offer = await createTreasuryCatPayoutOffer(config.walletRpc, {
    assetId,
    amountMojos,
    feeMojos: config.payoutFeeMojos,
  });

  return { offer, mode: "rpc" };
}
