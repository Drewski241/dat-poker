export type SymbolId =
  | "cherry"
  | "lemon"
  | "bell"
  | "chip"
  | "ace"
  | "king"
  | "wild"
  | "scatter"
  | "seven";

export interface SlotSymbol {
  id: SymbolId;
  label: string;
  emoji: string;
  tier: "low" | "mid" | "high" | "special";
}

export const SLOT_SYMBOLS: Record<SymbolId, SlotSymbol> = {
  cherry: { id: "cherry", label: "Cherry", emoji: "🍒", tier: "low" },
  lemon: { id: "lemon", label: "Lemon", emoji: "🍋", tier: "low" },
  bell: { id: "bell", label: "Bell", emoji: "🔔", tier: "mid" },
  chip: { id: "chip", label: "DAT Chip", emoji: "🪙", tier: "mid" },
  ace: { id: "ace", label: "Ace", emoji: "🂡", tier: "high" },
  king: { id: "king", label: "King", emoji: "🂮", tier: "high" },
  wild: { id: "wild", label: "Wild", emoji: "✨", tier: "special" },
  scatter: { id: "scatter", label: "Scatter", emoji: "💎", tier: "special" },
  seven: { id: "seven", label: "Lucky 7", emoji: "7️⃣", tier: "high" },
};

/** Weighted reel strips (higher weight = more common). */
export const REEL_STRIP: SymbolId[] = [
  "cherry",
  "cherry",
  "cherry",
  "lemon",
  "lemon",
  "lemon",
  "bell",
  "bell",
  "chip",
  "chip",
  "ace",
  "king",
  "wild",
  "scatter",
  "seven",
  "cherry",
  "lemon",
  "bell",
  "chip",
  "ace",
  "king",
  "cherry",
  "lemon",
  "bell",
];

/** Payout multipliers per line bet for 3/4/5 of a kind (wild substitutes). */
export const PAYTABLE: Partial<Record<SymbolId, [number, number, number]>> = {
  cherry: [2, 5, 10],
  lemon: [3, 8, 15],
  bell: [5, 12, 25],
  chip: [8, 20, 40],
  ace: [10, 30, 60],
  king: [12, 35, 75],
  seven: [25, 100, 500],
};

export const SCATTER_PAY_ANYWHERE: Record<number, number> = {
  3: 5,
  4: 20,
  5: 100,
};
