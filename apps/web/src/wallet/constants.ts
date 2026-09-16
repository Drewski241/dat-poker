import type { CoreTypes, ProposalTypes, SessionTypes } from "@walletconnect/types";

/** Official Reown/WalletConnect relay — same default as xch-dev/sage-dapp-example. */
export const WALLETCONNECT_RELAY_URL = "wss://relay.walletconnect.com";

/**
 * Methods we actually call after Sage approves (CHIP-0002 + Sage extras).
 * Kept required so a session that cannot load a DAT balance / sign a buy-in
 * does not look connected.
 */
export const SAGE_REQUIRED_METHODS = [
  "chip0002_getPublicKeys",
  "chip0002_getAssetBalance",
  "chip0002_signMessage",
  "chia_getAddress",
  "chia_signMessageByAddress",
  "chia_takeOffer",
] as const;

/** Methods supported by Sage WalletConnect (see xch-dev/sage src/walletconnect/commands.ts). */
export const SAGE_WC_METHODS = [
  "chip0002_connect",
  "chip0002_chainId",
  "chip0002_getPublicKeys",
  "chip0002_getAssetBalance",
  "chip0002_getAssetCoins",
  "chip0002_signMessage",
  "chia_getAddress",
  "chia_signMessageByAddress",
  "chia_send",
  "chia_createOffer",
  "chia_takeOffer",
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

/** chia-gaming also proposes optional chia methods so wallets can accept a subset. */
export function optionalNamespaces(chainId: string): ProposalTypes.OptionalNamespaces {
  return {
    chia: {
      methods: [...SAGE_WC_METHODS],
      chains: [chainId],
      events: [],
    },
  };
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
