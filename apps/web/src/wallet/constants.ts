import type { CoreTypes, ProposalTypes, SessionTypes } from "@walletconnect/types";

export const CHIA_METHODS = [
  "chia_logIn",
  "chia_getWallets",
  "chia_getWalletBalance",
  "chia_getWalletBalances",
  "chia_getCurrentAddress",
  "chia_signMessageByAddress",
  "chia_verifySignature",
  "chia_getSyncStatus",
  "chip0002_getPublicKeys",
  "chip0002_signMessage",
] as const;

export function requiredNamespaces(chainId: string): ProposalTypes.RequiredNamespaces {
  return {
    chia: {
      methods: [...CHIA_METHODS],
      chains: [chainId],
      events: [],
    },
  };
}

export const DAPP_METADATA: CoreTypes.Metadata = {
  name: "DAT Poker",
  description: "NLHE poker with DAT Governance Token buy-ins on Chia",
  url: typeof window !== "undefined" ? window.location.origin : "https://dat-poker.local",
  icons: ["https://walletconnect.com/walletconnect-logo.png"],
};

export function parseFingerprint(account: string): number | undefined {
  const parts = account.split(":");
  const fingerprint = Number(parts[2]);
  return Number.isFinite(fingerprint) ? fingerprint : undefined;
}

export interface ChiaWalletInfo {
  id: number;
  name: string;
  type: number;
  meta?: { assetId?: string; name?: string };
}

export interface WalletBalance {
  confirmedWalletBalance: number;
  spendableBalance: number;
  walletId: number;
}

export interface SignMessageResult {
  pubkey: string;
  signature: string;
  success?: boolean;
}

export type WcSession = SessionTypes.Struct;
