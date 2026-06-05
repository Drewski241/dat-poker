import { createCatPayoutOffer } from "./cat-payout-offer.js";
import { createSageCatPayoutOffer } from "./sage-payout-offer.js";
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

export type { CatPayoutOfferParams };
