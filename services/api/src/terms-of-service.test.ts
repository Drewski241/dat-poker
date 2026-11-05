import { describe, expect, it, beforeEach } from "vitest";
import {
  assertTermsAccepted,
  resetTermsContentCacheForTests,
  termsAcceptanceValidDays,
} from "./terms-of-service.js";
import {
  isTermsAcceptanceOnFile,
  resetTermsAcceptancesForTests,
  setTermsAcceptanceForTests,
} from "./terms-acceptance-store.js";

describe("terms of service", () => {
  beforeEach(() => {
    process.env.DAT_TERMS_VERSION = "test-v1";
    process.env.DAT_TERMS_ACCEPTANCE_DAYS = "30";
    process.env.DAT_TERMS_ACCEPTANCE_PATH = "memory";
    resetTermsContentCacheForTests();
    resetTermsAcceptancesForTests();
  });

  it("requires matching version and explicit acceptance", () => {
    expect(() => assertTermsAccepted({ termsAccepted: false, termsVersion: "test-v1" })).toThrow(
      /Terms and Conditions/i,
    );
    expect(() => assertTermsAccepted({ termsAccepted: true, termsVersion: "old" })).toThrow(
      /updated/i,
    );
    expect(() => assertTermsAccepted({ termsAccepted: true, termsVersion: "test-v1" })).not.toThrow();
  });

  it("keeps acceptance on file until TTL or version change", async () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    setTermsAcceptanceForTests("user_1", "test-v1", new Date(now).toISOString());
    expect(await isTermsAcceptanceOnFile({ playerId: "user_1", termsVersion: "test-v1", nowMs: now })).toBe(
      true,
    );
    const later = now + termsAcceptanceValidDays() * 86400000 + 1;
    expect(
      await isTermsAcceptanceOnFile({ playerId: "user_1", termsVersion: "test-v1", nowMs: later }),
    ).toBe(false);
    expect(await isTermsAcceptanceOnFile({ playerId: "user_1", termsVersion: "test-v2", nowMs: now })).toBe(
      false,
    );
  });
});
