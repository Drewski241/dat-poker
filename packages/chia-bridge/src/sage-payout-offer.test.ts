import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSageCancelOfferRequest,
  buildSageImportKeyRequest,
  buildSageSendCatRequest,
  describeMissingSageCerts,
  describeSageFundsBlock,
  describeSageLoginNeeded,
  describeSageCancelFailed,
  describeSageCancelNeedsXch,
  describeSageEvictWait,
  describeSageGhostLeftoverOffers,
  describeSageMempoolConflict,
  describeSageNoSpendableCoins,
  describeSageOfferCancelWait,
  describeSageReuseOffer,
  describeSageWalletRpcFailure,
  emptySageTreasuryFunds,
  expandWalletPath,
  formatDatMojos,
  isCompletedSageOfferStatus,
  isSageMempoolConflict,
  leftoverSageOffersAreGhostRecords,
  leftoverSageOffersBlockNewPayout,
  leftoverCoinsLockedByOffer,
  normalizeSageOfferStatus,
  summarizeSageLeftoverOffer,
  summarizeSagePendingTransaction,
  summarizeSageLockedCoin,
  formatSageHoldDetails,
  buildSageCancelOffersRequest,
  sageTreasuryHasPendingSpend,
  rememberSageOfferCancel,
  resetSageOfferCancelMemory,
  wasSageOfferRecentlyCancelled,
  looksLikeSageSecretKey,
  openSageOfferIds,
  parseSageAmount,
  parseSageFingerprint,
  readSageTreasurySecretFromEnv,
  remapSageOfferError,
  sageCertSearchDirs,
  sageDatLooksLockedByPendingTake,
  sageDatLooksLockedInOffer,
  sageTreasuryCanBuildPayout,
} from "./sage-wallet-rpc.js";
import {
  decideSagePayoutAction,
  emptyTreasuryLastOffer,
  readTreasuryLastOffer,
  shouldEvictStuckPlayerTake,
  writeTreasuryLastOffer,
} from "./sage-last-offer.js";
import { buildSageCatGiftOfferRequest } from "./sage-payout-offer.js";

describe("expandWalletPath", () => {
  it("expands leading tilde", () => {
    expect(expandWalletPath("~/sage/ssl/wallet.crt")?.endsWith("/sage/ssl/wallet.crt")).toBe(true);
  });
});

describe("sageCertSearchDirs", () => {
  it("searches the AWS process user and the drop-in data dir", () => {
    const dirs = sageCertSearchDirs();
    expect(dirs).toContain("/home/ec2-user/.local/share/sage/ssl");
    expect(dirs).toContain("/opt/dat-poker/data/sage/ssl");
    expect(describeMissingSageCerts()).toMatch(/enable-treasury-sage\.sh/);
    expect(describeSageLoginNeeded(false)).toMatch(/load-treasury-key\.sh/);
    expect(describeSageLoginNeeded(false)).toMatch(/TREASURY_SAGE_PRIVATE_KEY/);
    expect(describeSageLoginNeeded(true)).toMatch(/TREASURY_SAGE_FINGERPRINT/);
    expect(buildSageImportKeyRequest("abc def")).toEqual({
      name: "treasury",
      key: "abc def",
      save_secrets: true,
      login: true,
    });
    const previousKey = process.env.TREASURY_SAGE_PRIVATE_KEY;
    process.env.TREASURY_SAGE_PRIVATE_KEY = '  "hexkey"  ';
    expect(readSageTreasurySecretFromEnv()).toBe("hexkey");
    if (previousKey === undefined) delete process.env.TREASURY_SAGE_PRIVATE_KEY;
    else process.env.TREASURY_SAGE_PRIVATE_KEY = previousKey;
    expect(looksLikeSageSecretKey("a".repeat(64))).toBe(true);
    expect(parseSageFingerprint("a".repeat(64))).toBeUndefined();
    expect(parseSageFingerprint("1234567890")).toBe(1234567890);
  });
});

describe("sage treasury coin selection", () => {
  it("parses Sage amounts and formats 50000 DAT", () => {
    expect(parseSageAmount("50000000")).toBe(50_000_000n);
    expect(parseSageAmount(50000000)).toBe(50_000_000n);
    expect(formatDatMojos(50_000_000n)).toBe("50000 DAT");
    expect(formatDatMojos(2_000n)).toBe("2 DAT");
  });

  it("maps Sage's plain-text coin selection 500 to a fund/sync message", () => {
    const message = describeSageWalletRpcFailure(
      500,
      "Wallet error: Coin selection error: no spendable coins",
    );
    expect(message).toMatch(/not finished syncing|does not see spendable DAT|no spendable coins/i);
    expect(message).not.toMatch(/invalid JSON/);
  });

  it("explains sync vs missing DAT vs missing XCH", () => {
    expect(
      describeSageNoSpendableCoins({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        address: "xch1treasury",
        syncedCoins: 0,
        totalCoins: 0,
        datSelectableMojos: 0n,
      }),
    ).toMatch(/not finished syncing/i);
    expect(
      describeSageNoSpendableCoins({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        address: "xch1treasury",
        syncedCoins: 4,
        totalCoins: 4,
        datSelectableMojos: 0n,
        xchSelectableMojos: 1_000n,
      }),
    ).toMatch(/does not see spendable DAT/i);
    expect(
      describeSageNoSpendableCoins(
        {
          ...emptySageTreasuryFunds("ab".repeat(32)),
          address: "xch1treasury",
          syncedCoins: 4,
          totalCoins: 4,
          datSelectableMojos: 50_000_000n,
          xchSelectableMojos: 0n,
        },
        2_000n,
      ),
    ).toMatch(/no XCH/i);
    expect(
      describeSageFundsBlock(
        {
          ...emptySageTreasuryFunds("ab".repeat(32)),
          datSelectableMojos: 50_000_000n,
          xchSelectableMojos: 1n,
        },
        2_000n,
      ),
    ).toBeNull();
    expect(
      describeSageFundsBlock(
        {
          ...emptySageTreasuryFunds("ab".repeat(32)),
          address: "xch1treasury",
          datBalanceMojos: 50_000_000n,
          datSelectableMojos: 0n,
          pendingOfferCount: 1,
          pendingTransactionCount: 1,
          xchSelectableMojos: 519_800_644_036n,
        },
        2_000n,
      ),
    ).toMatch(/locked by a leftover Sage offer/i);
    expect(
      describeSageNoSpendableCoins({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        pendingOfferCount: 1,
        pendingTransactionCount: 0,
      }),
    ).toMatch(/stale local records/i);
    expect(
      leftoverSageOffersAreGhostRecords({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingOfferCount: 1,
        pendingTransactionCount: 0,
      }),
    ).toBe(true);
    expect(describeSageGhostLeftoverOffers()).toMatch(/stale local records/i);
    expect(
      describeSageNoSpendableCoins({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        pendingOfferCount: 1,
        pendingTransactionCount: 1,
      }),
    ).toMatch(/leftoverOffers, pendingTransactions, and lockedCoins/i);
    expect(
      remapSageOfferError("Wallet error: Coin selection error: no spendable coins", {
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datSelectableMojos: 50_000_000n,
        xchSelectableMojos: 0n,
        address: "xch1treasury",
      }, 2_000n),
    ).toMatch(/xch1treasury/);
    expect(isSageMempoolConflict("Wallet error: mempool conflict")).toBe(true);
    expect(isSageMempoolConflict("DOUBLE_SPEND")).toBe(true);
    expect(isSageMempoolConflict("Conflicting transaction already in the mempool")).toBe(true);
    expect(isSageMempoolConflict("Coin selection error: no spendable coins")).toBe(false);
    expect(
      leftoverSageOffersBlockNewPayout({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingOfferCount: 1,
      }),
    ).toBe(false);
    expect(
      leftoverSageOffersBlockNewPayout({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingOfferCount: 0,
      }),
    ).toBe(false);
    expect(
      leftoverSageOffersBlockNewPayout(
        {
          ...emptySageTreasuryFunds("ab".repeat(32)),
          pendingOfferCount: 1,
          datSelectableMojos: 50_000_000n,
        },
        2_000n,
      ),
    ).toBe(false);
    expect(
      sageTreasuryCanBuildPayout(
        {
          ...emptySageTreasuryFunds("ab".repeat(32)),
          datSelectableMojos: 50_000_000n,
        },
        2_000n,
      ),
    ).toBe(true);
    expect(
      sageTreasuryHasPendingSpend({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingTransactionCount: 1,
      }),
    ).toBe(true);
    expect(describeSageOfferCancelWait(9_000_000n)).toMatch(/cancel Confirmed/i);
    expect(describeSageOfferCancelWait(9_000_000n)).toMatch(/do not tap Accept/i);
    expect(describeSageOfferCancelWait(9_000_000n)).toMatch(/0\.000009 XCH/i);
    expect(describeSageOfferCancelWait(9_000_000n)).toMatch(/0\.09 mojo\/cost/i);
    expect(
      describeSageCancelNeedsXch(
        { ...emptySageTreasuryFunds("ab".repeat(32)), address: "xch1treasury", xchSelectableMojos: 0n },
        9_000_000n,
      ),
    ).toMatch(/needs a 0\.000009 XCH dust-storm fee/i);
    expect(
      describeSageCancelFailed(
        { cancelled: [], mempoolConflict: [], failed: ["offer-1"], errors: ["Wallet error: no XCH"], skippedRecent: [], submittedOnChain: false, coinSpendCount: 0 },
        { ...emptySageTreasuryFunds("ab".repeat(32)), xchSelectableMojos: 1n },
        1_000_000n,
      ),
    ).toMatch(/Cancel requires an XCH fee/i);
    expect(
      remapSageOfferError("Wallet error: mempool conflict", emptySageTreasuryFunds()),
    ).toMatch(/pending on-chain spend/i);
    expect(describeSageWalletRpcFailure(500, "DOUBLE_SPEND")).toMatch(/pending on-chain spend/i);
    expect(describeSageMempoolConflict()).toMatch(/Do not withdraw again/i);
    expect(
      describeSageMempoolConflict({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingTransactionCount: 1,
      }),
    ).toMatch(/Transactions shows no pending spends/i);
    expect(
      sageDatLooksLockedByPendingTake({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        pendingOfferCount: 0,
      }),
    ).toBe(true);
    expect(
      sageDatLooksLockedInOffer({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        pendingOfferCount: 0,
      }),
    ).toBe(false);
    expect(
      describeSageNoSpendableCoins({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        address: "xch1treasury",
        syncedCoins: 4,
        totalCoins: 4,
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        xchSelectableMojos: 519_800_644_036n,
        pendingOfferCount: 0,
      }),
    ).toMatch(/pending incoming DAT/i);
    expect(buildSageCancelOfferRequest("offer-abc", 9_000_000n)).toEqual({
      offer_id: "offer-abc",
      fee: "9000000",
      auto_submit: true,
    });
    expect(buildSageCancelOfferRequest("offer-abc", 0n).fee).toBe("9000000");
    expect(buildSageCancelOfferRequest("offer-abc", 1_000_000n).fee).toBe("9000000");
    expect(buildSageCancelOffersRequest(["offer-abc", "offer-def"], 1_000_000n)).toEqual({
      offer_ids: ["offer-abc", "offer-def"],
      fee: "18000000",
      auto_submit: true,
    });
    resetSageOfferCancelMemory();
    rememberSageOfferCancel("offer-abc", 1_000);
    expect(wasSageOfferRecentlyCancelled("offer-abc", 1_000 + 60_000)).toBe(true);
    expect(wasSageOfferRecentlyCancelled("offer-abc", 1_000 + 4 * 60_000)).toBe(false);
    resetSageOfferCancelMemory();
    expect(openSageOfferIds([
      { offer_id: "keep-pending", status: "pending" },
      { offer_id: "keep-active", status: "active" },
      { offer_id: "skip-done", status: "completed" },
      { offerId: "keep-numeric", status: 0 },
    ])).toEqual(["keep-pending", "keep-active", "keep-numeric"]);
    expect(
      sageDatLooksLockedInOffer({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        pendingOfferCount: 1,
        lockedCoins: [
          {
            coinId: "aa".repeat(32),
            asset: "DAT",
            amountMojos: "50000000",
            offerId: "offer-lock",
            transactionId: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      leftoverCoinsLockedByOffer({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        lockedCoins: [
          {
            coinId: "aa".repeat(32),
            asset: "DAT",
            amountMojos: "50000000",
            offerId: "offer-lock",
            transactionId: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      leftoverSageOffersAreGhostRecords({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingOfferCount: 1,
        pendingTransactionCount: 0,
        lockedCoins: [
          {
            coinId: "aa".repeat(32),
            asset: "DAT",
            amountMojos: "50000000",
            offerId: "offer-lock",
            transactionId: null,
          },
        ],
      }),
    ).toBe(false);
    expect(
      leftoverSageOffersBlockNewPayout({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingOfferCount: 1,
        datSelectableMojos: 50_000_000n,
        lockedCoins: [
          {
            coinId: "aa".repeat(32),
            asset: "XCH",
            amountMojos: "9000000",
            offerId: "offer-lock",
            transactionId: null,
          },
        ],
      }, 2_000n),
    ).toBe(true);
    expect(
      describeSageNoSpendableCoins({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        address: "xch1treasury",
        syncedCoins: 4,
        totalCoins: 4,
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        xchSelectableMojos: 519_800_644_036n,
        pendingOfferCount: 1,
        pendingTransactionCount: 0,
      }),
    ).toMatch(/stale local records/i);
    expect(summarizeSageLeftoverOffer({
      offer_id: "offer-abc",
      status: "pending",
      summary: { maker: [{ asset: { asset_id: "ab".repeat(32) }, amount: "2000" }] },
    })).toEqual({
      offerId: "offer-abc",
      status: "pending",
      offeredMojos: "2000",
      offeredAssetId: "ab".repeat(32),
    });
    expect(summarizeSagePendingTransaction({
      transaction_id: "tx-hold",
      fee: "9000000",
      spent: [{ coin_id: "coin-1" }],
    })).toEqual({
      transactionId: "tx-hold",
      feeMojos: "9000000",
      spentCoinIds: ["coin-1"],
    });
    expect(summarizeSageLockedCoin({
      coin_id: "coin-lock",
      amount: "50000000",
      offer_id: "offer-lock",
      spent_height: null,
    }, "DAT")).toEqual({
      coinId: "coin-lock",
      asset: "DAT",
      amountMojos: "50000000",
      offerId: "offer-lock",
      transactionId: null,
    });
    expect(summarizeSageLockedCoin({
      coin_id: "spent-coin",
      amount: "1",
      offer_id: "offer-lock",
      spent_height: 1,
    }, "DAT")).toBeNull();
    expect(formatSageHoldDetails({
      ...emptySageTreasuryFunds("ab".repeat(32)),
      leftoverOffers: [{ offerId: "offer-abcdef1234567890", status: "pending", offeredMojos: "2000", offeredAssetId: null }],
      pendingTransactions: [{ transactionId: "tx-abcdef1234567890", feeMojos: "9000000", spentCoinIds: ["coin-1"] }],
      lockedCoins: [{
        coinId: "coinabcdef1234567890",
        asset: "DAT",
        amountMojos: "2000",
        offerId: "offer-abcdef1234567890",
        transactionId: null,
      }],
    })).toMatch(/Leftover offer id\(s\): offer-abcdef1234/);
  });
});

describe("Sage offer status + send_cat evict", () => {
  it("normalizes Sage offer statuses", () => {
    expect(normalizeSageOfferStatus(0)).toBe("pending");
    expect(normalizeSageOfferStatus("active")).toBe("active");
    expect(normalizeSageOfferStatus(2)).toBe("completed");
    expect(normalizeSageOfferStatus("cancelled")).toBe("cancelled");
    expect(isCompletedSageOfferStatus(2)).toBe(true);
    expect(describeSageReuseOffer()).toMatch(/do not paste it again/i);
    expect(describeSageEvictWait(9_000_000n)).toMatch(/sent selectable DAT back to itself/i);
    expect(describeSageEvictWait(9_000_000n)).toMatch(/evictPending/i);
  });

  it("builds send_cat of selectable DAT to the treasury address", () => {
    expect(
      buildSageSendCatRequest({
        assetId: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
        address: "xch1treasury",
        amountMojos: 49_998_000n,
        feeMojos: 1_000_000n,
      }),
    ).toEqual({
      asset_id: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
      address: "xch1treasury",
      amount: "49998000",
      fee: "9000000",
      include_hint: true,
      auto_submit: true,
    });
  });

  it("round-trips the last-offer file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "sage-last-")), "treasury-last-offer.json");
    writeTreasuryLastOffer(
      emptyTreasuryLastOffer({
        offer: "offer1abc",
        offerId: "offer-id-1",
        amountMojos: "2000",
        assetId: "ab".repeat(32),
        status: "pending",
      }),
      path,
    );
    expect(readTreasuryLastOffer(path)?.offer).toBe("offer1abc");
    expect(JSON.parse(readFileSync(path, "utf8")).offerId).toBe("offer-id-1");
  });
});

describe("decideSagePayoutAction", () => {
  const selectable = {
    ...emptySageTreasuryFunds("ab".repeat(32)),
    address: "xch1treasury",
    datSelectableMojos: 49_998_000n,
    datBalanceMojos: 49_998_000n,
    xchSelectableMojos: 519_800_644_036n,
    pendingOfferCount: 0,
    pendingTransactionCount: 0,
  };

  it("reuses a still-pending last offer instead of remaking", () => {
    const action = decideSagePayoutAction({
      funds: selectable,
      neededMojos: 2_000n,
      feeMojos: 9_000_000n,
      lastOffer: emptyTreasuryLastOffer({ offer: "offer1same", status: "pending" }),
      reusable: { offer: "offer1same", offerId: "id-1", status: "pending" },
    });
    expect(action.kind).toBe("reuse");
    if (action.kind === "reuse") {
      expect(action.offer).toBe("offer1same");
      expect(action.message).toMatch(/do not paste it again/i);
    }
  });

  it("evicts when coins look free and there is no reusable last offer", () => {
    expect(
      shouldEvictStuckPlayerTake({
        funds: selectable,
        neededMojos: 2_000n,
        lastOffer: null,
        reusable: null,
      }),
    ).toBe(true);
    const action = decideSagePayoutAction({
      funds: selectable,
      neededMojos: 2_000n,
      feeMojos: 9_000_000n,
      lastOffer: null,
      reusable: null,
    });
    expect(action.kind).toBe("evict");
    if (action.kind === "evict") {
      expect(action.amountMojos).toBe(49_998_000n);
      expect(action.address).toBe("xch1treasury");
      expect(action.feeMojos).toBe(9_000_000n);
    }
  });

  it("makes a new offer after the evict confirms", () => {
    const action = decideSagePayoutAction({
      funds: selectable,
      neededMojos: 2_000n,
      feeMojos: 9_000_000n,
      lastOffer: emptyTreasuryLastOffer({
        evictedAt: "2026-09-25T00:00:00.000Z",
        status: "cancelled",
      }),
      reusable: null,
    });
    expect(action.kind).toBe("make-offer");
  });

  it("waits when an evict is still pending", () => {
    const action = decideSagePayoutAction({
      funds: { ...selectable, pendingTransactionCount: 1 },
      neededMojos: 2_000n,
      feeMojos: 9_000_000n,
      lastOffer: emptyTreasuryLastOffer({ evictedAt: "2026-09-25T00:00:00.000Z" }),
      reusable: null,
    });
    expect(action.kind).toBe("wait-evict");
  });

  it("makes a new payout after the last offer completed", () => {
    const action = decideSagePayoutAction({
      funds: selectable,
      neededMojos: 2_000n,
      feeMojos: 9_000_000n,
      lastOffer: emptyTreasuryLastOffer({ offer: "offer1done", status: "completed" }),
      reusable: { offer: "offer1done", offerId: "id-1", status: "completed" },
    });
    expect(action.kind).toBe("make-offer");
  });

  it("tells the player they are done when the last offer completed and DAT is gone", () => {
    const action = decideSagePayoutAction({
      funds: { ...selectable, datSelectableMojos: 0n, datBalanceMojos: 0n },
      neededMojos: 2_000n,
      feeMojos: 9_000_000n,
      lastOffer: emptyTreasuryLastOffer({ offer: "offer1done", status: "completed" }),
      reusable: { offer: "offer1done", offerId: "id-1", status: "completed" },
    });
    expect(action.kind).toBe("completed");
  });
});

describe("buildSageCatGiftOfferRequest", () => {
  it("offers CAT with no requested assets (treasury gift)", () => {
    const req = buildSageCatGiftOfferRequest({
      assetId: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
      amountMojos: 50_000n,
      feeMojos: 0n,
    });
    expect(req).toEqual({
      offered_assets: [
        {
          asset_id: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
          amount: 50_000,
        },
      ],
      requested_assets: [],
      fee: "0",
      expires_at_second: null,
    });
  });
});
