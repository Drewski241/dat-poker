import type { CoreTypes, ProposalTypes, SessionTypes } from "@walletconnect/types";

/** Methods supported by Sage WalletConnect (see xch-dev/sage src/walletconnect/commands.ts) */
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
      methods: [...SAGE_WC_METHODS],
      chains: [chainId],
      events: [],
    },
  };
}

export const DAPP_METADATA: CoreTypes.Metadata = {
  name: import.meta.env.VITE_APP_STAGE === "beta" ? "DAT Poker (beta)" : "DAT Poker",
  description:
    import.meta.env.VITE_APP_STAGE === "beta"
      ? "Public beta — NLHE on Chia with DAT buy-ins. Software under development."
      : "NLHE poker with DAT Governance Token buy-ins on Chia",
  url: typeof window !== "undefined" ? window.location.origin : "https://dat-poker.local",
  icons: ["https://walletconnect.com/walletconnect-logo.png"],
};

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
