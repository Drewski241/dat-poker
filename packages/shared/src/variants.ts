import type { PokerVariant } from "./types.js";

export type VariantFamily = "holdem" | "omaha" | "draw" | "stud" | "mixed" | "chia";

export interface VariantMeta {
  id: PokerVariant;
  label: string;
  family: VariantFamily;
  holeCards: number;
  communityCards: number;
  bettingStructure: "no-limit" | "pot-limit" | "fixed-limit";
  /** Ace is low for ranking / lowball goals. */
  aceLow?: boolean;
  /** Lowest hand wins (lowball). */
  lowball?: boolean;
  /** Split pot high/low (8-or-better). */
  hiLo?: boolean;
  /** Max cards a player may discard per draw round (draw family). */
  maxDrawCards?: number;
  /** Number of draw rounds (draw family). */
  drawRounds?: number;
  /** Pocket cards that must be discarded before showdown (pineapple family). */
  discardToHoleCards?: number;
  /** When pineapple discard is required. */
  discardTiming?: "preflop" | "turn" | "river";
  chiaGamingNative: boolean;
  notes?: string;
}

/** Catalog of supported / planned variants for lobby and routing. */
export const POKER_VARIANTS: VariantMeta[] = [
  {
    id: "nlhe",
    label: "No-Limit Hold'em",
    family: "holdem",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "no-limit",
    chiaGamingNative: false,
  },
  {
    id: "plhe",
    label: "Pot-Limit Hold'em",
    family: "holdem",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
  },
  {
    id: "plo4",
    label: "Pot-Limit Omaha (4)",
    family: "omaha",
    holeCards: 4,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
  },
  {
    id: "plo5",
    label: "Pot-Limit Omaha (5)",
    family: "omaha",
    holeCards: 5,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
  },
  {
    id: "plo6",
    label: "Pot-Limit Omaha (6)",
    family: "omaha",
    holeCards: 6,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
  },
  {
    id: "plo4_hl",
    label: "Pot-Limit Omaha Hi/Lo",
    family: "omaha",
    holeCards: 4,
    communityCards: 5,
    bettingStructure: "pot-limit",
    aceLow: true,
    hiLo: true,
    chiaGamingNative: false,
    notes: "Must use exactly 2 hole + 3 board; low is Ace-to-5 eight-or-better.",
  },
  {
    id: "omaha",
    label: "Omaha Hold'em",
    family: "omaha",
    holeCards: 4,
    communityCards: 5,
    bettingStructure: "pot-limit",
    chiaGamingNative: false,
    notes: "Alias of Pot-Limit Omaha (4); five community cards dealt face-up across streets.",
  },
  {
    id: "pineapple",
    label: "Pineapple",
    family: "holdem",
    holeCards: 3,
    communityCards: 5,
    bettingStructure: "no-limit",
    discardToHoleCards: 2,
    discardTiming: "preflop",
    chiaGamingNative: false,
    notes: "Discard one pocket card before the first betting round.",
  },
  {
    id: "crazy_pineapple",
    label: "Crazy Pineapple",
    family: "holdem",
    holeCards: 3,
    communityCards: 5,
    bettingStructure: "no-limit",
    discardToHoleCards: 2,
    discardTiming: "turn",
    chiaGamingNative: false,
    notes: "Discard one pocket card before the turn.",
  },
  {
    id: "lazy_pineapple",
    label: "Lazy Pineapple",
    family: "holdem",
    holeCards: 3,
    communityCards: 5,
    bettingStructure: "no-limit",
    discardToHoleCards: 2,
    discardTiming: "river",
    chiaGamingNative: false,
    notes: "Discard one pocket card before the river.",
  },
  {
    id: "five_card_draw",
    label: "Five-Card Draw",
    family: "draw",
    holeCards: 5,
    communityCards: 0,
    bettingStructure: "no-limit",
    maxDrawCards: 3,
    drawRounds: 1,
    chiaGamingNative: false,
  },
  {
    id: "draw",
    label: "Draw Poker",
    family: "draw",
    holeCards: 5,
    communityCards: 0,
    bettingStructure: "no-limit",
    maxDrawCards: 3,
    drawRounds: 1,
    chiaGamingNative: false,
    notes: "Generic draw; same structure as five-card draw.",
  },
  {
    id: "triple_draw_27",
    label: "2-7 Triple Draw",
    family: "draw",
    holeCards: 5,
    communityCards: 0,
    bettingStructure: "fixed-limit",
    aceLow: false,
    lowball: true,
    maxDrawCards: 5,
    drawRounds: 3,
    chiaGamingNative: false,
    notes: "Deuce-to-seven lowball; lowest hand wins; three draw rounds.",
  },
  {
    id: "badugi",
    label: "Badugi",
    family: "draw",
    holeCards: 4,
    communityCards: 0,
    bettingStructure: "fixed-limit",
    aceLow: true,
    lowball: true,
    maxDrawCards: 4,
    drawRounds: 3,
    chiaGamingNative: false,
    notes: "Best hand is four different suits and ranks; Ace is low.",
  },
  {
    id: "seven_card_stud",
    label: "Seven-Card Stud",
    family: "stud",
    holeCards: 7,
    communityCards: 0,
    bettingStructure: "fixed-limit",
    chiaGamingNative: false,
    notes: "Three down, four up; best five-card high hand wins.",
  },
  {
    id: "stud",
    label: "Stud Poker",
    family: "stud",
    holeCards: 7,
    communityCards: 0,
    bettingStructure: "fixed-limit",
    chiaGamingNative: false,
    notes: "Alias of seven-card stud.",
  },
  {
    id: "razz",
    label: "Razz",
    family: "stud",
    holeCards: 7,
    communityCards: 0,
    bettingStructure: "fixed-limit",
    aceLow: true,
    lowball: true,
    chiaGamingNative: false,
    notes: "Seven-card stud Ace-to-5 lowball; lowest hand wins; no draws.",
  },
  {
    id: "calpoker",
    label: "California Poker (Chia Gaming)",
    family: "chia",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "no-limit",
    chiaGamingNative: true,
    notes: "Reference implementation in chia-gaming; head-to-head state channels.",
  },
  {
    id: "horse",
    label: "H.O.R.S.E.",
    family: "mixed",
    holeCards: 2,
    communityCards: 5,
    bettingStructure: "fixed-limit",
    chiaGamingNative: false,
    notes: "Mixed rotation; engine delegates per street round.",
  },
];

export function getVariantMeta(id: PokerVariant): VariantMeta | undefined {
  return POKER_VARIANTS.find((v) => v.id === id);
}

export function isOmahaVariant(id: PokerVariant | string | null | undefined): boolean {
  return (
    id === "plo4" ||
    id === "plo5" ||
    id === "plo6" ||
    id === "plo4_hl" ||
    id === "omaha"
  );
}

export function isOmahaHiLoVariant(id: PokerVariant | string | null | undefined): boolean {
  return id === "plo4_hl";
}

export function isPineappleVariant(id: PokerVariant | string | null | undefined): boolean {
  return id === "pineapple" || id === "crazy_pineapple" || id === "lazy_pineapple";
}

export function isDrawFamilyVariant(id: PokerVariant | string | null | undefined): boolean {
  const meta = id ? getVariantMeta(id as PokerVariant) : undefined;
  return meta?.family === "draw";
}

export function isStudFamilyVariant(id: PokerVariant | string | null | undefined): boolean {
  const meta = id ? getVariantMeta(id as PokerVariant) : undefined;
  return meta?.family === "stud";
}

export function isHoldemFamilyVariant(id: PokerVariant | string | null | undefined): boolean {
  const meta = id ? getVariantMeta(id as PokerVariant) : undefined;
  return meta?.family === "holdem" || meta?.family === "omaha" || meta?.family === "chia";
}

export function isPotLimitVariant(id: PokerVariant | string | null | undefined): boolean {
  if (!id) return false;
  return getVariantMeta(id as PokerVariant)?.bettingStructure === "pot-limit";
}

export function isLowballVariant(id: PokerVariant | string | null | undefined): boolean {
  if (!id) return false;
  return Boolean(getVariantMeta(id as PokerVariant)?.lowball);
}

export function holeCardCountForVariant(id: PokerVariant | string | null | undefined): number {
  if (!id) return 2;
  return getVariantMeta(id as PokerVariant)?.holeCards ?? 2;
}

/** Normalize aliases used by clients / lobby buttons. */
export function normalizePokerVariant(raw: string | null | undefined): PokerVariant | null {
  if (!raw) return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[/]+/g, "_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  const aliases: Record<string, PokerVariant> = {
    plo: "plo4",
    omaha: "omaha",
    omaha_holdem: "omaha",
    omaha_hi_lo: "plo4_hl",
    omaha_hilo: "plo4_hl",
    plo_hl: "plo4_hl",
    plo4hl: "plo4_hl",
    five_card_draw: "five_card_draw",
    "5_card_draw": "five_card_draw",
    draw_5: "five_card_draw",
    "27": "triple_draw_27",
    "2_7": "triple_draw_27",
    "2_7_triple_draw": "triple_draw_27",
    triple_draw: "triple_draw_27",
    seven_card_stud: "seven_card_stud",
    "7_card_stud": "seven_card_stud",
    stud7: "seven_card_stud",
    crazy: "crazy_pineapple",
    lazy: "lazy_pineapple",
  };
  if (aliases[key]) return aliases[key];
  if (POKER_VARIANTS.some((v) => v.id === key)) return key as PokerVariant;
  return null;
}
