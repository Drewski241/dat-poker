import { describe, expect, it } from "vitest";
import {
  buildSageImportKeyRequest,
  describeMissingSageCerts,
  describeSageLoginNeeded,
  expandWalletPath,
  looksLikeSageSecretKey,
  parseSageFingerprint,
  readSageTreasurySecretFromEnv,
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
