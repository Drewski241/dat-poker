import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";
import { assertPlayCompliance, blockedCountryCodes } from "./play-compliance.js";

function fakeReq(headers: Record<string, string> = {}): FastifyRequest {
  return {
    ip: "203.0.113.1",
    headers,
  } as FastifyRequest;
}

describe("play compliance", () => {
  beforeEach(() => {
    process.env.DAT_PLAY_COMPLIANCE_MODE = "test";
    process.env.DAT_BLOCKED_COUNTRY_CODES = "CU,IR";
  });

  it("allows a matching attestation in test mode", async () => {
    const result = await assertPlayCompliance(fakeReq({ "cf-ipcountry": "US" }), {
      countryCode: "US",
      ageConfirmed: true,
      turnstileToken: "test-pass",
    });
    expect(result.countryCode).toBe("US");
  });

  it("rejects blocked declared countries", async () => {
    await expect(
      assertPlayCompliance(fakeReq(), {
        countryCode: "CU",
        ageConfirmed: true,
        turnstileToken: "test-pass",
      }),
    ).rejects.toThrow(/not available/i);
  });

  it("rejects when IP country is blocked", async () => {
    await expect(
      assertPlayCompliance(fakeReq({ "cf-ipcountry": "IR" }), {
        countryCode: "US",
        ageConfirmed: true,
        turnstileToken: "test-pass",
      }),
    ).rejects.toThrow(/network region/i);
  });

  it("rejects country mismatch with IP", async () => {
    await expect(
      assertPlayCompliance(fakeReq({ "cf-ipcountry": "CA" }), {
        countryCode: "US",
        ageConfirmed: true,
        turnstileToken: "test-pass",
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("skips checks when compliance mode is off", async () => {
    process.env.DAT_PLAY_COMPLIANCE_MODE = "off";
    const result = await assertPlayCompliance(fakeReq(), undefined);
    expect(result.countryCode).toBe("US");
    expect(blockedCountryCodes().has("CU")).toBe(true);
  });
});
