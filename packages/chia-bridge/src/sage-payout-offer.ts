import { resolveSageMakeOfferFeeMojos } from "@dat-poker/shared";
import type { CatPayoutOfferParams } from "./cat-payout-offer.js";
import {
  describeSageFundsBlock,
  describeSageOfferCancelWait,
  ensureSageTreasuryLoggedIn,
  leftoverSageOffersBlockNewPayout,
  readSageTreasuryFunds,
  releaseOpenSageOffers,
  remapSageOfferError,
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
  const feeMojos = resolveSageMakeOfferFeeMojos(params.feeMojos);
  const funds = await readSageTreasuryFunds(rpc, params.assetId);
  if (leftoverSageOffersBlockNewPayout(funds)) {
    await releaseOpenSageOffers(rpc, feeMojos);
    throw new Error(describeSageOfferCancelWait());
  }
  const blocked = describeSageFundsBlock(funds, params.amountMojos);
  if (blocked) {
    throw new Error(blocked);
  }
  const request = buildSageCatGiftOfferRequest({ ...params, feeMojos });
  try {
    const response = await treasuryWalletRpcRequest<SageMakeOfferResponse>(rpc, "make_offer", request);
    const offer = response.offer?.trim();
    if (!offer) {
      throw new Error("Sage treasury wallet did not return an offer");
    }
    return offer;
  } catch (error) {
    throw new Error(remapSageOfferError((error as Error).message, funds, params.amountMojos));
  }
}
