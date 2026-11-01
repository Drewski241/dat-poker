import { SLOT_SYMBOLS, type SymbolId } from "@dat-poker/slot-engine";
import { CARD_EMOJI, cardLabel, type CardCode, type CardRank } from "@dat-poker/slot-engine";
import { HOUSE_SYMBOLS, type HouseSymbolId } from "@dat-poker/slot-engine";
import { MINE_SYMBOLS, type MineSymbolId } from "@dat-poker/slot-engine";
import { STAMPEDE_SYMBOLS, type StampedeSymbolId } from "@dat-poker/slot-engine";
import type { SlotGameId } from "@dat-poker/shared";

export type SymbolDisplay = {
  emoji: string;
  label: string;
  /** Poker reels: red vs black felt styling */
  pokerRed?: boolean;
  pokerRank?: string;
};

const RANK_DISPLAY: Record<CardRank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

export function symbolDisplay(gameId: SlotGameId, id: string): SymbolDisplay {
  if (gameId === "spirit") {
    const sym = SLOT_SYMBOLS[id as SymbolId];
    return sym ? { emoji: sym.emoji, label: sym.label } : { emoji: "?", label: id };
  }
  if (gameId === "mine-mojo") {
    const sym = MINE_SYMBOLS[id as MineSymbolId];
    return sym ? { emoji: sym.emoji, label: sym.label } : { emoji: "?", label: id };
  }
  if (gameId === "poker-hands") {
    if (id.length >= 2 && id[0]! in CARD_EMOJI) {
      const suit = id[0] as keyof typeof CARD_EMOJI;
      const rank = id.slice(1) as CardRank;
      return {
        emoji: CARD_EMOJI[suit],
        label: cardLabel(id as CardCode),
        pokerRed: suit === "h" || suit === "d",
        pokerRank: RANK_DISPLAY[rank] ?? rank,
      };
    }
    return { emoji: "🂠", label: id };
  }
  if (gameId === "spirit-stampede") {
    const sym = STAMPEDE_SYMBOLS[id as StampedeSymbolId];
    return sym ? { emoji: sym.emoji, label: sym.label } : { emoji: "?", label: id };
  }
  if (gameId === "house-edge") {
    const sym = HOUSE_SYMBOLS[id as HouseSymbolId];
    return sym ? { emoji: sym.emoji, label: sym.label } : { emoji: "?", label: id };
  }
  return { emoji: "?", label: id };
}
