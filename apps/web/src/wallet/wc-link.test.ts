import { describe, expect, it } from "vitest";
import { isMobileUserAgent, walletConnectUniversalLink } from "./wc-link.js";

describe("walletConnectUniversalLink", () => {
  it("wraps the wc URI for wallet apps", () => {
    const uri = "wc:abc@2?relay-protocol=irn&symKey=xyz";
    expect(walletConnectUniversalLink(uri)).toBe(
      `https://walletconnect.com/wc?uri=${encodeURIComponent(uri)}`,
    );
  });
});

describe("isMobileUserAgent", () => {
  it("detects iPhone user agents", () => {
    expect(isMobileUserAgent()).toBe(false);
  });
});
