import { resolveSageMakeOfferFeeMojos } from "@dat-poker/shared";
import type { CatPayoutOfferParams } from "./cat-payout-offer.js";
import {
  decideSagePayoutAction,
  defaultTreasuryLastOfferPath,
  emptyTreasuryLastOffer,
  readTreasuryLastOffer,
  writeTreasuryLastOffer,
  type ReusableSageOffer,
  type TreasuryLastOffer,
} from "./sage-last-offer.js";
import {
  describeSageCancelFailed,
  describeSageCancelNeedsXch,
  describeSageFundsBlock,
  describeSageLockHold,
  describeSageOfferCancelWait,
  describeSagePendingTreasurySpend,
  ensureSageTreasuryLoggedIn,
  getSageOffer,
  leftoverSageOffersBlockNewPayout,
  normalizeSageOfferStatus,
  readSageTreasuryFunds,
  remapSageOfferError,
  sageRpcAmount,
  sendSageCat,
  sageTreasuryHasPendingSpend,
  cancelOpenSageOffers,
  deleteOpenSageOffers,
  treasuryWalletRpcRequest,
  viewSageOffer,
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

function lastOfferPath(params: CatPayoutOfferParams): string {
  return params.lastOfferPath?.trim() || defaultTreasuryLastOfferPath();
}

function persistLastOffer(path: string, record: TreasuryLastOffer): void {
  try {
    writeTreasuryLastOffer(record, path);
  } catch {
    /* next withdraw may evict or remake if the marker is missing */
  }
}

export async function resolveReusableSageOffer(
  rpc: TreasuryWalletRpcConfig,
  last: TreasuryLastOffer | null,
  leftoverOfferIds: string[] = [],
): Promise<ReusableSageOffer | null> {
  if (last?.offer?.startsWith("offer1")) {
    const viewed = await viewSageOffer(rpc, last.offer);
    if (viewed?.status != null) {
      return {
        offer: last.offer,
        offerId: last.offerId,
        status: normalizeSageOfferStatus(viewed.status),
      };
    }
  }
  const ids = [...new Set([last?.offerId, ...leftoverOfferIds].filter((id): id is string => Boolean(id)))];
  for (const offerId of ids) {
    const record = await getSageOffer(rpc, offerId);
    const offer =
      typeof record?.offer === "string" && record.offer.startsWith("offer1")
        ? record.offer
        : last?.offer ?? "";
    if (record && (offer.startsWith("offer1") || record.status != null)) {
      return {
        offer,
        offerId,
        status: normalizeSageOfferStatus(record.status),
      };
    }
  }
  return last
    ? { offer: last.offer, offerId: last.offerId, status: last.status }
    : null;
}

export async function createSageCatPayoutOffer(
  rpc: TreasuryWalletRpcConfig,
  params: CatPayoutOfferParams,
): Promise<string> {
  await ensureSageTreasuryLoggedIn(rpc);
  const feeMojos = resolveSageMakeOfferFeeMojos(params.feeMojos);
  const persistPath = lastOfferPath(params);
  let funds = await readSageTreasuryFunds(rpc, params.assetId);
  let last = readTreasuryLastOffer(persistPath);

  if (sageTreasuryHasPendingSpend(funds)) {
    const pending = decideSagePayoutAction({
      funds,
      neededMojos: params.amountMojos,
      feeMojos,
      lastOffer: last,
      reusable: null,
    });
    throw new Error("message" in pending ? pending.message : describeSagePendingTreasurySpend(funds));
  }

  if ((funds.pendingOfferCount ?? 0) > 0) {
    if (leftoverSageOffersBlockNewPayout(funds, params.amountMojos)) {
      if (funds.xchSelectableMojos === 0n) {
        throw new Error(describeSageCancelNeedsXch(funds, feeMojos));
      }
      const result = await cancelOpenSageOffers(rpc, feeMojos);
      if (
        result.failed.length > 0 &&
        result.cancelled.length === 0 &&
        result.mempoolConflict.length === 0 &&
        result.skippedRecent.length === 0
      ) {
        throw new Error(describeSageCancelFailed(result, funds, feeMojos));
      }
      funds = await readSageTreasuryFunds(rpc, params.assetId);
      if (sageTreasuryHasPendingSpend(funds) || result.submittedOnChain) {
        throw new Error(describeSageOfferCancelWait(feeMojos, funds));
      }
    }
    await deleteOpenSageOffers(rpc);
    funds = await readSageTreasuryFunds(rpc, params.assetId);
    if (sageTreasuryHasPendingSpend(funds)) {
      throw new Error(describeSagePendingTreasurySpend(funds));
    }
    if (leftoverSageOffersBlockNewPayout(funds, params.amountMojos)) {
      throw new Error(describeSageLockHold(funds));
    }
  }

  const leftoverIds = (funds.leftoverOffers ?? []).map((offer) => offer.offerId);
  const reusable = await resolveReusableSageOffer(rpc, last, leftoverIds);
  const action = decideSagePayoutAction({
    funds,
    neededMojos: params.amountMojos,
    feeMojos,
    lastOffer: last,
    reusable,
  });

  if (action.kind === "reuse") {
    persistLastOffer(persistPath, {
      ...(last ?? emptyTreasuryLastOffer()),
      offer: action.offer,
      offerId: action.offerId,
      amountMojos: last?.amountMojos ?? params.amountMojos.toString(),
      assetId: last?.assetId || params.assetId.replace(/^0x/i, "").toLowerCase(),
      status: action.status,
    });
    return action.offer;
  }

  if (
    action.kind === "wait-pending-spend" ||
    action.kind === "wait-evict" ||
    action.kind === "completed" ||
    action.kind === "blocked"
  ) {
    throw new Error(action.message);
  }

  if (action.kind === "evict") {
    try {
      const sent = await sendSageCat(rpc, {
        assetId: params.assetId,
        address: action.address,
        amountMojos: action.amountMojos,
        feeMojos: action.feeMojos,
      });
      persistLastOffer(persistPath, {
        ...(last ?? emptyTreasuryLastOffer()),
        assetId: params.assetId.replace(/^0x/i, "").toLowerCase(),
        amountMojos: action.amountMojos.toString(),
        status: last?.status && last.status !== "unknown" ? last.status : "cancelled",
        evictedAt: new Date().toISOString(),
        evictTxId: typeof sent.transaction_id === "string" ? sent.transaction_id : null,
      });
    } catch (error) {
      throw new Error(remapSageOfferError((error as Error).message, funds, params.amountMojos));
    }
    throw new Error(action.message);
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
    persistLastOffer(persistPath, {
      offer,
      offerId: response.offer_id?.trim() || last?.offerId || null,
      amountMojos: params.amountMojos.toString(),
      assetId: params.assetId.replace(/^0x/i, "").toLowerCase(),
      createdAt: new Date().toISOString(),
      status: "pending",
      evictedAt: null,
      evictTxId: null,
    });
    return offer;
  } catch (error) {
    throw new Error(remapSageOfferError((error as Error).message, funds, params.amountMojos));
  }
}
