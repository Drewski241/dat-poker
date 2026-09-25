import { describe, expect, it } from "vitest";
import {
  buildSageCancelOfferRequest,
  buildSageImportKeyRequest,
  describeMissingSageCerts,
  describeSageFundsBlock,
  describeSageLoginNeeded,
  describeSageCancelFailed,
  describeSageCancelNeedsXch,
  describeSageMempoolConflict,
  describeSageNoSpendableCoins,
  describeSageOfferCancelWait,
  describeSageWalletRpcFailure,
  emptySageTreasuryFunds,
  expandWalletPath,
  formatDatMojos,
  isSageMempoolConflict,
  leftoverSageOffersBlockNewPayout,
  looksLikeSageSecretKey,
  openSageOfferIds,
  parseSageAmount,
  parseSageFingerprint,
  readSageTreasurySecretFromEnv,
  remapSageOfferError,
  sageCertSearchDirs,
  sageDatLooksLockedInOffer,
} from "./sage-wallet-rpc.js";
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
          xchSelectableMojos: 519_800_644_036n,
        },
        2_000n,
      ),
    ).toMatch(/locked in an unused Sage offer/i);
    expect(
      describeSageNoSpendableCoins({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datBalanceMojos: 50_000_000n,
        datSelectableMojos: 0n,
        pendingOfferCount: 1,
      }),
    ).toMatch(/release-treasury-offers\.sh/);
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
    ).toBe(true);
    expect(
      leftoverSageOffersBlockNewPayout({
        ...emptySageTreasuryFunds("ab".repeat(32)),
        pendingOfferCount: 0,
      }),
    ).toBe(false);
    expect(describeSageOfferCancelWait(1_000_000n)).toMatch(/wait 1–2 minutes/i);
    expect(describeSageOfferCancelWait(1_000_000n)).toMatch(/do not tap Accept/i);
    expect(describeSageOfferCancelWait(1_000_000n)).toMatch(/0\.000001 XCH fee/i);
    expect(
      describeSageCancelNeedsXch(
        { ...emptySageTreasuryFunds("ab".repeat(32)), address: "xch1treasury", xchSelectableMojos: 0n },
        1_000_000n,
      ),
    ).toMatch(/needs a 0\.000001 XCH fee/i);
    expect(
      describeSageCancelFailed(
        { cancelled: [], mempoolConflict: [], failed: ["offer-1"], errors: ["Wallet error: no XCH"] },
        { ...emptySageTreasuryFunds("ab".repeat(32)), xchSelectableMojos: 1n },
        1_000_000n,
      ),
    ).toMatch(/Cancel requires an XCH fee/i);
    expect(
      remapSageOfferError("Wallet error: mempool conflict", emptySageTreasuryFunds()),
    ).toMatch(/do not tap Accept again/i);
    expect(describeSageWalletRpcFailure(500, "DOUBLE_SPEND")).toMatch(/mempool conflict/i);
    expect(describeSageMempoolConflict()).toMatch(/old offer/i);
    expect(buildSageCancelOfferRequest("offer-abc", 1_000_000n)).toEqual({
      offer_id: "offer-abc",
      fee: "1000000",
      auto_submit: true,
    });
    expect(buildSageCancelOfferRequest("offer-abc", 0n).fee).toBe("1000000");
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
      }),
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
      }),
    ).toMatch(/locked in an unused Sage offer/i);
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
