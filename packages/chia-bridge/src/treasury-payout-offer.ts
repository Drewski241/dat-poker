import { createCatPayoutOffer } from "./cat-payout-offer.js";
import { createSageCatPayoutOffer } from "./sage-payout-offer.js";
import { createSageNftPayoutOffer, type NftPayoutOfferParams } from "./sage-nft-payout-offer.js";
import type { CatPayoutOfferParams } from "./cat-payout-offer.js";
import type { TreasuryWalletRpcConfig } from "./sage-wallet-rpc.js";

export async function createTreasuryCatPayoutOffer(
  rpc: TreasuryWalletRpcConfig,
  params: CatPayoutOfferParams,
): Promise<string> {
  if (rpc.backend === "sage") {
    return createSageCatPayoutOffer(rpc, params);
  }
  return createCatPayoutOffer(rpc, params);
}

export async function createTreasuryNftPayoutOffer(
  rpc: TreasuryWalletRpcConfig,
  params: NftPayoutOfferParams,
): Promise<string> {
  if (rpc.backend !== "sage") {
    throw new Error("NFT treasury gifts require TREASURY_WALLET_BACKEND=sage");
  }
  return createSageNftPayoutOffer(rpc, params);
}

export type { CatPayoutOfferParams, NftPayoutOfferParams };
