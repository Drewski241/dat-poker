import type { CoreTypes, ProposalTypes, SessionTypes } from "@walletconnect/types";

/** Official Reown/WalletConnect relay — same default as xch-dev/sage-dapp-example. */
export const WALLETCONNECT_RELAY_URL = "wss://relay.walletconnect.com";

/**
 * Spend RPCs that can drain Sage. The public beta site must never request
 * these. Buy-in / redeem only sign CHIP-0002 messages; in-game DAT is a ledger.
 */
export const SAGE_FORBIDDEN_SPEND_METHODS = [
  "chia_send",
  "chia_createOffer",
  "chia_cancelOffer",
  "chip0002_signCoinSpends",
  "chip0002_sendTransaction",
] as const;

/**
 * Allowed only for claiming a treasury NFT gift offer (player receives NFT).
 * Still counted as a "spend method" for session inspection, but optional at pair time.
 */
export const SAGE_TAKE_OFFER_METHOD = "chia_takeOffer" as const;

/** @deprecated Use {@link SAGE_FORBIDDEN_SPEND_METHODS} + {@link SAGE_TAKE_OFFER_METHOD}. */
export const SAGE_SPEND_METHODS = [
  ...SAGE_FORBIDDEN_SPEND_METHODS,
  SAGE_TAKE_OFFER_METHOD,
] as const;

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

/** Optional extras Sage may grant (includes takeOffer for NFT gift claims). */
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

/** Drain-capable methods that must never be on a beta session. */
export function sessionForbiddenSpendMethods(session: SessionTypes.Struct): string[] {
  const forbidden = new Set<string>(SAGE_FORBIDDEN_SPEND_METHODS);
  return sessionMethodList(session).filter((method) => forbidden.has(method));
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
