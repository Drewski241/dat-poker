import { SLOT_SYMBOLS, type SymbolId } from "@dat-poker/slot-engine";
import { CARD_EMOJI, cardLabel, type CardCode } from "@dat-poker/slot-engine";
import { HOUSE_SYMBOLS, type HouseSymbolId } from "@dat-poker/slot-engine";
import { MINE_SYMBOLS, type MineSymbolId } from "@dat-poker/slot-engine";
import { STAMPEDE_SYMBOLS, type StampedeSymbolId } from "@dat-poker/slot-engine";
import type { SlotGameId } from "@dat-poker/shared";

export function symbolDisplay(gameId: SlotGameId, id: string): { emoji: string; label: string } {
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
      return { emoji: CARD_EMOJI[id[0] as keyof typeof CARD_EMOJI], label: cardLabel(id as CardCode) };
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
