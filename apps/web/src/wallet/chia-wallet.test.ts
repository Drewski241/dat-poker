import { describe, expect, it } from "vitest";
import { isChiaOfferString, mapWalletConnectError, takeOffer } from "./chia-wallet.js";
import {
  SAGE_DRAIN_METHODS,
  SAGE_REQUIRED_METHODS,
  SAGE_SPEND_METHODS,
  SAGE_TAKE_OFFER_METHOD,
  SAGE_WC_METHODS,
  WALLETCONNECT_RELAY_URL,
  dappMetadata,
  optionalNamespaces,
  requiredNamespaces,
  sessionCanTakeOffer,
  sessionDrainMethods,
  sessionSpendMethods,
} from "./constants.js";
import type { WcSession } from "./constants.js";

describe("WalletConnect namespaces", () => {
  it("proposes chia required methods that DAT Poker actually calls", () => {
    const required = requiredNamespaces("chia:mainnet");
    expect(required.chia.chains).toEqual(["chia:mainnet"]);
    expect(required.chia.methods).toEqual([...SAGE_REQUIRED_METHODS]);
    expect(required.chia.methods).toContain("chia_getAddress");
    expect(required.chia.methods).toContain("chia_signMessageByAddress");
  });

  it("never requests Sage send/create-offer RPCs that could drain a wallet", () => {
    const required = requiredNamespaces("chia:mainnet");
    const optional = optionalNamespaces("chia:mainnet");
    for (const method of SAGE_DRAIN_METHODS) {
      expect(required.chia.methods).not.toContain(method);
      expect(optional.chia.methods).not.toContain(method);
      expect(SAGE_WC_METHODS).not.toContain(method);
    }
    expect(required.chia.methods).not.toContain(SAGE_TAKE_OFFER_METHOD);
    expect(optional.chia.methods).toContain(SAGE_TAKE_OFFER_METHOD);
    expect(SAGE_SPEND_METHODS).toContain(SAGE_TAKE_OFFER_METHOD);
  });

  it("lists Sage read/sign methods as optional extras", () => {
    const optional = optionalNamespaces("chia:mainnet");
    expect(optional.chia.methods).toEqual([...SAGE_WC_METHODS]);
    expect(optional.chia.methods).toContain("chip0002_connect");
  });

  it("uses the official Reown relay", () => {
    expect(WALLETCONNECT_RELAY_URL).toBe("wss://relay.walletconnect.com");
  });

  it("uses the page origin in dapp metadata so Reown verify matches the site", () => {
    expect(dappMetadata().url).toMatch(/^https?:\/\//);
  });

  it("flags restored sessions that still have spend methods", () => {
    const session = {
      namespaces: { chia: { methods: ["chia_getAddress", "chia_takeOffer"], accounts: [], events: [] } },
    } as unknown as WcSession;
    expect(sessionSpendMethods(session)).toEqual(["chia_takeOffer"]);
    expect(sessionCanTakeOffer(session)).toBe(true);
    expect(sessionDrainMethods(session)).toEqual([]);
  });

  it("drops send-capable sessions but keeps takeOffer-only pairings", () => {
    const drainSession = {
      namespaces: { chia: { methods: ["chia_getAddress", "chia_send"], accounts: [], events: [] } },
    } as unknown as WcSession;
    expect(sessionDrainMethods(drainSession)).toEqual(["chia_send"]);
  });
});

describe("isChiaOfferString", () => {
  it("accepts offer1 strings and rejects junk", () => {
    expect(isChiaOfferString("offer1abcxyz")).toBe(true);
    expect(isChiaOfferString("  offer1qqq  ")).toBe(true);
    expect(isChiaOfferString("xch1notanoffer")).toBe(false);
    expect(isChiaOfferString("")).toBe(false);
  });

  it("does not call WalletConnect for a non-offer string", async () => {
    const session = {
      namespaces: { chia: { methods: ["chia_takeOffer"], accounts: [], events: [] } },
    } as unknown as WcSession;
    await expect(takeOffer(session, "project", "chia:mainnet", "xch1nope")).rejects.toThrow(/offer1/i);
  });

  it("asks the player to reconnect when the pairing lacks takeOffer", async () => {
    const session = {
      namespaces: { chia: { methods: ["chia_getAddress"], accounts: [], events: [] } },
    } as unknown as WcSession;
    await expect(takeOffer(session, "project", "chia:mainnet", "offer1abc")).rejects.toThrow(/Connect Sage again/i);
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
