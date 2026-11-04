import type { PokerVariant } from "./types.js";

export interface VariantMeta {
  id: PokerVariant;
  label: string;
  holeCards: number;
  communityCards: number;
  bettingStructure: "no-limit" | "pot-limit" | "fixed-limit";
  /** True when chia-gaming already ships the on-chain referee for this variant. */
  chiaGamingNative: boolean;
  /** Every variant's heads-up match uses a chia-gaming channel. The stake is still DAT. */
  headsUpViaChiaGaming: boolean;
  notes?: string;
}

/** Catalog of supported / planned variants for lobby and routing. */
export const POKER_VARIANTS: VariantMeta[] = [
  {
    id: "nlhe",
    label: "No-Limit Hold'em",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "no-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
    notes: "Heads-up uses a chia-gaming channel. Rules run here until a matching referee ships. Stake is DAT.",
  },
  {
    id: "plhe",
    label: "Pot-Limit Hold'em",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
  },
  {
    id: "plo4",
    label: "Pot-Limit Omaha (4)",
    holeCards: 4,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
  },
  {
    id: "plo5",
    label: "Pot-Limit Omaha (5)",
    holeCards: 5,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
  },
  {
    id: "plo6",
    label: "Pot-Limit Omaha (6)",
    holeCards: 6,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
  },
  {
    id: "calpoker",
    label: "California Poker (Chia Gaming)",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "no-limit",
    chiaGamingNative: true,
    headsUpViaChiaGaming: true,
    notes: "Upstream chia-gaming referee. Heads-up channel stake is DAT, not XCH.",
  },
  {
    id: "stud",
    label: "Seven Card Stud",
    holeCards: 7,
    communityCards: 0,
    bettingStructure: "fixed-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
  },
  {
    id: "razz",
    label: "Razz",
    holeCards: 7,
    communityCards: 0,
    bettingStructure: "fixed-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
  },
  {
    id: "horse",
    label: "H.O.R.S.E.",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "fixed-limit",
    chiaGamingNative: false,
    headsUpViaChiaGaming: true,
    notes: "Mixed rotation; engine delegates per street round. Heads-up still uses a chia-gaming channel.",
  },
];

export function getVariantMeta(id: PokerVariant): VariantMeta | undefined {
  return POKER_VARIANTS.find((v) => v.id === id);
}
