import { resolveSageMakeOfferFeeMojos } from "@dat-poker/shared";
import type { CatPayoutOfferParams } from "./cat-payout-offer.js";
import {
  describeSageFundsBlock,
  describeSageGhostLeftoverOffers,
  describeSagePendingPlayerTake,
  describeSagePendingTreasurySpend,
  ensureSageTreasuryLoggedIn,
  leftoverSageOffersBlockNewPayout,
  leftoverSageOffersAreGhostRecords,
  readSageTreasuryFunds,
  sageDatLooksLockedByPendingTake,
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
  if ((funds.pendingOfferCount ?? 0) > 0) {
    await deleteOpenSageOffers(rpc);
    funds = await readSageTreasuryFunds(rpc, params.assetId);
    if (sageTreasuryHasPendingSpend(funds)) {
      throw new Error(describeSagePendingTreasurySpend());
    }
  }
  if (leftoverSageOffersBlockNewPayout(funds, params.amountMojos)) {
    if (leftoverSageOffersAreGhostRecords(funds)) {
      throw new Error(describeSageGhostLeftoverOffers());
    }
    throw new Error(describeSagePendingTreasurySpend());
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
