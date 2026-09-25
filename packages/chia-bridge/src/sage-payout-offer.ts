import { resolveSageMakeOfferFeeMojos } from "@dat-poker/shared";
import type { CatPayoutOfferParams } from "./cat-payout-offer.js";
import {
  cancelOpenSageOffers,
  describeSageCancelFailed,
  describeSageCancelNeedsXch,
  describeSageFundsBlock,
  describeSageOfferCancelWait,
  describeSagePendingPlayerTake,
  describeSagePendingTreasurySpend,
  ensureSageTreasuryLoggedIn,
  leftoverSageOffersBlockNewPayout,
  readSageTreasuryFunds,
  sageDatLooksLockedByPendingTake,
  sageTreasuryCanBuildPayout,
  sageTreasuryHasPendingSpend,
  deleteOpenSageOffers,
  remapSageOfferError,
  sageRpcAmount,
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
    fee: sageRpcAmount(params.feeMojos ?? 0n),
    expires_at_second: null,
  };
}

export async function createSageCatPayoutOffer(
  rpc: TreasuryWalletRpcConfig,
  params: CatPayoutOfferParams,
): Promise<string> {
  await ensureSageTreasuryLoggedIn(rpc);
  const feeMojos = resolveSageMakeOfferFeeMojos(params.feeMojos);
  let funds = await readSageTreasuryFunds(rpc, params.assetId);
  if (sageTreasuryHasPendingSpend(funds)) {
    throw new Error(describeSagePendingTreasurySpend());
  }
  if ((funds.pendingOfferCount ?? 0) > 0 && sageTreasuryCanBuildPayout(funds, params.amountMojos)) {
    await deleteOpenSageOffers(rpc);
    funds = await readSageTreasuryFunds(rpc, params.assetId);
    if (sageTreasuryHasPendingSpend(funds)) {
      throw new Error(describeSagePendingTreasurySpend());
    }
  }
  if (leftoverSageOffersBlockNewPayout(funds, params.amountMojos)) {
    if (funds.xchSelectableMojos === 0n) {
      throw new Error(describeSageCancelNeedsXch(funds, feeMojos));
    }
    const cancelled = await cancelOpenSageOffers(rpc, feeMojos);
    if (
      cancelled.cancelled.length === 0 &&
      cancelled.mempoolConflict.length === 0 &&
      cancelled.skippedRecent.length === 0
    ) {
      throw new Error(describeSageCancelFailed(cancelled, funds, feeMojos));
    }
    throw new Error(describeSageOfferCancelWait(feeMojos));
  }
  if (sageDatLooksLockedByPendingTake(funds)) {
    throw new Error(describeSagePendingPlayerTake());
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
