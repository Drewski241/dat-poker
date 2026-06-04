import { describe, expect, it } from "vitest";
import { expandWalletPath } from "./chia-wallet-rpc.js";

describe("expandWalletPath", () => {
  it("expands leading tilde", () => {
    expect(expandWalletPath("~/chia/ssl/wallet.crt")?.endsWith("/chia/ssl/wallet.crt")).toBe(true);
  });

  it("passes through absolute paths", () => {
    expect(expandWalletPath("/etc/ssl/wallet.crt")).toBe("/etc/ssl/wallet.crt");
  });
});
