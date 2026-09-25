import type { CoreTypes, ProposalTypes, SessionTypes } from "@walletconnect/types";

/** Official Reown/WalletConnect relay — same default as xch-dev/sage-dapp-example. */
export const WALLETCONNECT_RELAY_URL = "wss://relay.walletconnect.com";

/**
 * RPCs that can send coins out of Sage without a treasury offer.
 * The site must never request these. `chia_takeOffer` is separate — we only
 * call it with the offer1 string our treasury just built.
 */
export const SAGE_DRAIN_METHODS = [
  "chia_send",
  "chia_createOffer",
  "chia_cancelOffer",
  "chip0002_signCoinSpends",
  "chip0002_sendTransaction",
] as const;

export const SAGE_TAKE_OFFER_METHOD = "chia_takeOffer";

/**
 * Spend / offer RPCs that can move coins out of Sage.
 */
export const SAGE_SPEND_METHODS = [...SAGE_DRAIN_METHODS, SAGE_TAKE_OFFER_METHOD] as const;

/**
 * Methods we actually call after Sage approves.
 * Sign-message methods cannot authorize a spend (CHIP-0002 prefixes the
 * payload with "Chia Signed Message").
 */
export const SAGE_REQUIRED_METHODS = [
  "chip0002_getPublicKeys",
  "chip0002_getAssetBalance",
  "chip0002_signMessage",
  "chia_getAddress",
  "chia_signMessageByAddress",
] as const;

/** Optional extras Sage may grant. Includes takeOffer for the treasury popup. */
export const SAGE_WC_METHODS = [
  "chip0002_connect",
  "chip0002_chainId",
  "chip0002_getPublicKeys",
  "chip0002_getAssetBalance",
  "chip0002_getAssetCoins",
  "chip0002_signMessage",
  "chia_getAddress",
  "chia_signMessageByAddress",
  SAGE_TAKE_OFFER_METHOD,
] as const;

export function requiredNamespaces(chainId: string): ProposalTypes.RequiredNamespaces {
  return {
    chia: {
      methods: [...SAGE_REQUIRED_METHODS],
      chains: [chainId],
      events: [],
    },
  };
}

export function optionalNamespaces(chainId: string): ProposalTypes.OptionalNamespaces {
  return {
    chia: {
      methods: [...SAGE_WC_METHODS],
      chains: [chainId],
      events: [],
    },
  };
}

export function sessionMethodList(session: SessionTypes.Struct): string[] {
  return session.namespaces?.chia?.methods ?? [];
}

export function sessionSpendMethods(session: SessionTypes.Struct): string[] {
  const spend = new Set<string>(SAGE_SPEND_METHODS);
  return sessionMethodList(session).filter((method) => spend.has(method));
}

export function sessionDrainMethods(session: SessionTypes.Struct): string[] {
  const drain = new Set<string>(SAGE_DRAIN_METHODS);
  return sessionMethodList(session).filter((method) => drain.has(method));
}

export function sessionCanTakeOffer(session: SessionTypes.Struct): boolean {
  return sessionMethodList(session).includes(SAGE_TAKE_OFFER_METHOD);
}

export function dappMetadata(): CoreTypes.Metadata {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://datspiritpoker.com";
  return {
    name: import.meta.env.VITE_APP_STAGE === "beta" ? "DAT Poker (beta)" : "DAT Poker",
    description:
      import.meta.env.VITE_APP_STAGE === "beta"
        ? "Public beta — NLHE on Chia with DAT buy-ins. Software under development."
        : "NLHE poker with DAT Governance Token buy-ins on Chia",
    url: origin,
    icons: ["https://walletconnect.com/walletconnect-logo.png"],
  };
}

export interface AssetBalance {
  confirmed: string;
  spendable: string;
  spendableCoinCount: number;
}

export interface SignMessageResult {
  pubkey: string;
  signature: string;
}

export type WcSession = SessionTypes.Struct;
