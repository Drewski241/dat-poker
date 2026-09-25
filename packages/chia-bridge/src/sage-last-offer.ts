import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  describeSageEvictNeedsXch,
  describeSageEvictWait,
  describeSageFundsBlock,
  describeSageLockHold,
  describeSageOfferCompleted,
  describeSagePendingPlayerTake,
  describeSagePendingTreasurySpend,
  describeSageReuseOffer,
  isCompletedSageOfferStatus,
  isOpenSageOfferStatus,
  leftoverSageOffersBlockNewPayout,
  normalizeSageOfferStatus,
  sageDatLooksLockedByPendingTake,
  sageTreasuryCanBuildPayout,
  sageTreasuryHasPendingSpend,
  type SageOfferStatusName,
  type SageTreasuryFunds,
} from "./sage-wallet-rpc.js";

export interface TreasuryLastOffer {
  offer: string;
  offerId: string | null;
  amountMojos: string;
  assetId: string;
  createdAt: string;
  status: SageOfferStatusName;
  evictedAt: string | null;
  evictTxId: string | null;
}

export type SagePayoutAction =
  | { kind: "reuse"; offer: string; offerId: string | null; status: SageOfferStatusName; message: string }
  | { kind: "completed"; message: string }
  | { kind: "wait-pending-spend"; message: string }
  | { kind: "wait-evict"; message: string }
  | { kind: "evict"; amountMojos: bigint; address: string; feeMojos: bigint; message: string }
  | { kind: "make-offer" }
  | { kind: "blocked"; message: string };

export interface ReusableSageOffer {
  offer: string;
  offerId: string | null;
  status: SageOfferStatusName;
}

export function defaultTreasuryLastOfferPath(): string {
  const configured = process.env.TREASURY_LAST_OFFER_PATH?.trim();
  if (configured) return configured;
  return join(process.cwd(), "data", "treasury-last-offer.json");
}

export function emptyTreasuryLastOffer(
  overrides: Partial<TreasuryLastOffer> = {},
): TreasuryLastOffer {
  return {
    offer: "",
    offerId: null,
    amountMojos: "0",
    assetId: "",
    createdAt: new Date(0).toISOString(),
    status: "unknown",
    evictedAt: null,
    evictTxId: null,
    ...overrides,
  };
}

function parseLastOffer(raw: unknown): TreasuryLastOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const offer = typeof record.offer === "string" ? record.offer.trim() : "";
  const offerId =
    typeof record.offerId === "string" && record.offerId.trim() ? record.offerId.trim() : null;
  const amountMojos =
    typeof record.amountMojos === "string" && /^\d+$/.test(record.amountMojos)
      ? record.amountMojos
      : "0";
  const assetId = typeof record.assetId === "string" ? record.assetId.trim() : "";
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt.trim()
      ? record.createdAt.trim()
      : new Date(0).toISOString();
  const evictedAt =
    typeof record.evictedAt === "string" && record.evictedAt.trim() ? record.evictedAt.trim() : null;
  const evictTxId =
    typeof record.evictTxId === "string" && record.evictTxId.trim() ? record.evictTxId.trim() : null;
  return {
    offer,
    offerId,
    amountMojos,
    assetId,
    createdAt,
    status: normalizeSageOfferStatus(record.status),
    evictedAt,
    evictTxId,
  };
}

export function readTreasuryLastOffer(path = defaultTreasuryLastOfferPath()): TreasuryLastOffer | null {
  try {
    return parseLastOffer(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function writeTreasuryLastOffer(
  record: TreasuryLastOffer,
  path = defaultTreasuryLastOfferPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function clearTreasuryLastOffer(path = defaultTreasuryLastOfferPath()): void {
  try {
    unlinkSync(path);
  } catch {
    /* missing is fine */
  }
}

export function lastOfferLooksReusable(last: TreasuryLastOffer | null): boolean {
  return Boolean(last?.offer?.startsWith("offer1") && isOpenSageOfferStatus(last.status));
}

export function shouldEvictStuckPlayerTake(input: {
  funds: SageTreasuryFunds;
  neededMojos: bigint;
  lastOffer: TreasuryLastOffer | null;
  reusable: ReusableSageOffer | null;
}): boolean {
  const { funds, neededMojos, lastOffer, reusable } = input;
  if (lastOffer?.evictedAt) return false;
  if (reusable && isOpenSageOfferStatus(reusable.status)) return false;
  if (reusable && isCompletedSageOfferStatus(reusable.status)) return false;
  if (isCompletedSageOfferStatus(lastOffer?.status)) return false;
  if (leftoverSageOffersBlockNewPayout(funds, neededMojos)) return false;
  if (!funds.address?.trim()) return false;
  return sageTreasuryCanBuildPayout(funds, neededMojos);
}

export function decideSagePayoutAction(input: {
  funds: SageTreasuryFunds;
  neededMojos: bigint;
  feeMojos: bigint;
  lastOffer: TreasuryLastOffer | null;
  reusable: ReusableSageOffer | null;
}): SagePayoutAction {
  const { funds, neededMojos, feeMojos, lastOffer, reusable } = input;

  if (sageTreasuryHasPendingSpend(funds)) {
    if (lastOffer?.evictedAt) {
      return { kind: "wait-evict", message: describeSageEvictWait(feeMojos) };
    }
    return { kind: "wait-pending-spend", message: describeSagePendingTreasurySpend(funds) };
  }

  if (reusable && isOpenSageOfferStatus(reusable.status) && reusable.offer.startsWith("offer1")) {
    return {
      kind: "reuse",
      offer: reusable.offer,
      offerId: reusable.offerId,
      status: reusable.status,
      message: describeSageReuseOffer(),
    };
  }

  if (lastOfferLooksReusable(lastOffer) && lastOffer?.offer.startsWith("offer1")) {
    return {
      kind: "reuse",
      offer: lastOffer.offer,
      offerId: lastOffer.offerId,
      status: lastOffer.status,
      message: describeSageReuseOffer(),
    };
  }

  if (
    (reusable && isCompletedSageOfferStatus(reusable.status)) ||
    isCompletedSageOfferStatus(lastOffer?.status)
  ) {
    if (sageTreasuryCanBuildPayout(funds, neededMojos)) {
      return { kind: "make-offer" };
    }
    return { kind: "completed", message: describeSageOfferCompleted() };
  }

  if (sageDatLooksLockedByPendingTake(funds)) {
    return { kind: "blocked", message: describeSagePendingPlayerTake() };
  }

  if (leftoverSageOffersBlockNewPayout(funds, neededMojos)) {
    return { kind: "blocked", message: describeSageLockHold(funds) };
  }

  if (shouldEvictStuckPlayerTake({ funds, neededMojos, lastOffer, reusable })) {
    if (funds.xchSelectableMojos === 0n) {
      return { kind: "blocked", message: describeSageEvictNeedsXch(funds, feeMojos) };
    }
    const amountMojos = funds.datSelectableMojos ?? 0n;
    return {
      kind: "evict",
      amountMojos,
      address: funds.address!.trim(),
      feeMojos,
      message: describeSageEvictWait(feeMojos),
    };
  }

  const blocked = describeSageFundsBlock(funds, neededMojos);
  if (blocked) {
    return { kind: "blocked", message: blocked };
  }
  return { kind: "make-offer" };
}
