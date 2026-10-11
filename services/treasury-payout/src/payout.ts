import {
  createTreasuryCatPayoutOffer,
  createTreasuryNftPayoutOffer,
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
  nftPayoutFeeMojos: bigint;
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
    nftPayoutFeeMojos: BigInt(
      process.env.TREASURY_NFT_PAYOUT_FEE_MOJOS ??
        process.env.TREASURY_PAYOUT_FEE_MOJOS ??
        "500000000",
    ),
    walletRpc: readTreasuryWalletRpcConfigFromEnv(),
  };
}

export interface PayoutRequestBody {
  assetId?: string;
  address: string;
  amountMojos: string;
}

export interface NftPayoutRequestBody {
  nftId: string;
  address: string;
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
    throw new Error(
      "Sage treasury RPC not configured — enable RPC in Sage (Settings → Advanced), or set TREASURY_WALLET_CERT_PATH and TREASURY_WALLET_KEY_PATH (or TREASURY_OFFER_MODE=mock for dev)",
    );
  }

  const offer = await createTreasuryCatPayoutOffer(config.walletRpc, {
    assetId,
    amountMojos,
    feeMojos: config.payoutFeeMojos,
  });

  return { offer, mode: "rpc" };
}

export async function buildNftPayoutOffer(
  config: TreasuryServiceConfig,
  body: NftPayoutRequestBody,
): Promise<{ offer: string; mode: TreasuryOfferMode; feeMojos: string }> {
  const nftId = body.nftId?.trim();
  if (!nftId) {
    throw new Error("nftId required");
  }
  if (!body.address?.trim()) {
    throw new Error("address required");
  }

  if (config.offerMode === "mock") {
    return {
      mode: "mock",
      offer: `mock-nft-offer:${nftId}:${body.address}`,
      feeMojos: config.nftPayoutFeeMojos.toString(),
    };
  }

  const hasCerts = Boolean(config.walletRpc.certPath && config.walletRpc.keyPath);
  if (!hasCerts) {
    throw new Error(
      "Sage treasury RPC not configured — enable RPC in Sage (Settings → Advanced), or set TREASURY_WALLET_CERT_PATH and TREASURY_WALLET_KEY_PATH (or set TREASURY_OFFER_MODE=mock for dev)",
    );
  }

  const offer = await createTreasuryNftPayoutOffer(config.walletRpc, {
    nftId,
    receiveAddress: body.address.trim(),
    feeMojos: config.nftPayoutFeeMojos,
  });

  return { offer, mode: "rpc", feeMojos: config.nftPayoutFeeMojos.toString() };
}
