import { describe, expect, it } from "vitest";
import { mapWalletConnectError } from "./chia-wallet.js";
import {
  SAGE_REQUIRED_METHODS,
  SAGE_WC_METHODS,
  WALLETCONNECT_RELAY_URL,
  dappMetadata,
  optionalNamespaces,
  requiredNamespaces,
} from "./constants.js";

describe("WalletConnect namespaces", () => {
  it("proposes chia required methods that DAT Poker actually calls", () => {
    const required = requiredNamespaces("chia:mainnet");
    expect(required.chia.chains).toEqual(["chia:mainnet"]);
    expect(required.chia.methods).toEqual([...SAGE_REQUIRED_METHODS]);
    expect(required.chia.methods).toContain("chia_getAddress");
    expect(required.chia.methods).toContain("chia_signMessageByAddress");
  });

  it("lists the full Sage method set as optional, matching sage-dapp-example", () => {
    const optional = optionalNamespaces("chia:mainnet");
    expect(optional.chia.methods).toEqual([...SAGE_WC_METHODS]);
    expect(optional.chia.methods).toContain("chip0002_connect");
    expect(optional.chia.methods).toContain("chia_takeOffer");
  });

  it("uses the official Reown relay", () => {
    expect(WALLETCONNECT_RELAY_URL).toBe("wss://relay.walletconnect.com");
  });

  it("uses the page origin in dapp metadata so Reown verify matches the site", () => {
    expect(dappMetadata().url).toMatch(/^https?:\/\//);
  });
});

describe("mapWalletConnectError", () => {
  it("explains Failed to publish custom payload so testers can fix Reown allowlist", () => {
    const mapped = mapWalletConnectError(
      new Error("Failed to publish custom payload, please try again. id:1789582956095329792 tag:undefined"),
    );
    expect(mapped.message).toContain("Failed to publish custom payload");
    expect(mapped.message).toContain("Allowed domains");
    expect(mapped.message).toContain("Reown");
  });

  it("passes through unrelated Sage errors", () => {
    const mapped = mapWalletConnectError(new Error("Sage did not return a public key"));
    expect(mapped.message).toBe("Sage did not return a public key");
  });
});
