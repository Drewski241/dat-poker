export type PlayingCardData = { rank: string; suit: string };

const SUIT_GLYPH: Record<string, string> = {
  c: "♣",
  d: "♦",
  h: "♥",
  s: "♠",
};

const SUIT_NAME: Record<string, string> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};

const RANK_NAME: Record<string, string> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  T: "10",
  "10": "10",
  "9": "9",
  "8": "8",
  "7": "7",
  "6": "6",
  "5": "5",
  "4": "4",
  "3": "3",
  "2": "2",
};

export function suitGlyph(suit: string): string {
  return SUIT_GLYPH[suit] ?? suit;
}

export function isRedSuit(suit: string): boolean {
  return suit === "h" || suit === "d";
}

export function rankFace(rank: string): string {
  if (rank === "T") return "10";
  return rank;
}

export function playingCardLabel(card: PlayingCardData): string {
  const rank = RANK_NAME[card.rank] ?? card.rank;
  const suit = SUIT_NAME[card.suit] ?? card.suit;
  return `${rank} of ${suit}`;
}
