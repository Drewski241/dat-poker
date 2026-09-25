import { describe, expect, it } from "vitest";
import {
  buildSageImportKeyRequest,
  describeMissingSageCerts,
  describeSageFundsBlock,
  describeSageLoginNeeded,
  describeSageNoSpendableCoins,
  describeSageWalletRpcFailure,
  emptySageTreasuryFunds,
  expandWalletPath,
  formatDatMojos,
  looksLikeSageSecretKey,
  parseSageAmount,
  parseSageFingerprint,
  readSageTreasurySecretFromEnv,
  remapSageOfferError,
  sageCertSearchDirs,
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
      remapSageOfferError("Wallet error: Coin selection error: no spendable coins", {
        ...emptySageTreasuryFunds("ab".repeat(32)),
        datSelectableMojos: 50_000_000n,
        xchSelectableMojos: 0n,
        address: "xch1treasury",
      }, 2_000n),
    ).toMatch(/xch1treasury/);
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
      fee: 0,
      expiration_seconds: null,
    });
  });
});
