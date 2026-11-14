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

/** Text-style suit, so the glyph takes the card's red or black instead of an emoji. */
export function suitMark(suit: string): string {
  return `${suitGlyph(suit)}\uFE0E`;
}

export type CardPip = { x: number; y: number; flip: boolean };

export type CardFace =
  | { kind: "ace" }
  | { kind: "court" }
  | { kind: "pips"; pips: CardPip[] };

const pip = (x: number, y: number, flip = false): CardPip => ({ x, y, flip });

/** Standard French-deck spots. Bottom pips are turned, the way a printed card is. */
const PIP_LAYOUT: Record<string, CardPip[]> = {
  "2": [pip(50, 22), pip(50, 78, true)],
  "3": [pip(50, 18), pip(50, 50), pip(50, 82, true)],
  "4": [pip(32, 22), pip(68, 22), pip(32, 78, true), pip(68, 78, true)],
  "5": [pip(32, 20), pip(68, 20), pip(50, 50), pip(32, 80, true), pip(68, 80, true)],
  "6": [pip(32, 18), pip(68, 18), pip(32, 50), pip(68, 50), pip(32, 82, true), pip(68, 82, true)],
  "7": [pip(32, 16), pip(68, 16), pip(50, 34), pip(32, 50), pip(68, 50), pip(32, 84, true), pip(68, 84, true)],
  "8": [
    pip(30, 12),
    pip(70, 12),
    pip(30, 37),
    pip(70, 37),
    pip(30, 63, true),
    pip(70, 63, true),
    pip(30, 88, true),
    pip(70, 88, true),
  ],
  "9": [
    pip(30, 10),
    pip(70, 10),
    pip(30, 32),
    pip(70, 32),
    pip(50, 50),
    pip(30, 68, true),
    pip(70, 68, true),
    pip(30, 90, true),
    pip(70, 90, true),
  ],
  T: [
    pip(30, 8),
    pip(70, 8),
    pip(30, 28),
    pip(70, 28),
    pip(50, 41),
    pip(50, 59, true),
    pip(30, 72, true),
    pip(70, 72, true),
    pip(30, 92, true),
    pip(70, 92, true),
  ],
};

export function cardFace(rank: string): CardFace {
  const key = rank === "10" ? "T" : rank;
  if (key === "A") return { kind: "ace" };
  if (key === "J" || key === "Q" || key === "K") return { kind: "court" };
  const pips = PIP_LAYOUT[key];
  if (!pips) return { kind: "ace" };
  return { kind: "pips", pips };
}
