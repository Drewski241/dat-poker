import type { CatPayoutOfferParams } from "./cat-payout-offer.js";
import {
  ensureSageTreasuryLoggedIn,
  treasuryWalletRpcRequest,
  type SageMakeOfferResponse,
  type TreasuryWalletRpcConfig,
} from "./sage-wallet-rpc.js";

export function buildSageCatGiftOfferRequest(params: CatPayoutOfferParams): Record<string, unknown> {
  const assetId = params.assetId.replace(/^0x/, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(assetId)) {
    throw new Error("Invalid CAT asset id (expected 64 hex chars)");
  }
  if (params.amountMojos <= 0n) {
    throw new Error("Payout amount must be positive");
  }
  const amount = Number(params.amountMojos);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Payout amount too large for Sage RPC");
  }

  return {
    offered_assets: [{ asset_id: assetId, amount }],
    requested_assets: [],
    fee: Number(params.feeMojos ?? 0n),
    expiration_seconds: null,
  };
}

export async function createSageCatPayoutOffer(
  rpc: TreasuryWalletRpcConfig,
  params: CatPayoutOfferParams,
): Promise<string> {
  await ensureSageTreasuryLoggedIn(rpc);
  const request = buildSageCatGiftOfferRequest(params);
  const response = await treasuryWalletRpcRequest<SageMakeOfferResponse>(rpc, "make_offer", request);
  const offer = response.offer?.trim();
  if (!offer) {
    throw new Error("Sage treasury wallet did not return an offer");
  }
  return offer;
}
