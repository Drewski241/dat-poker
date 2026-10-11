import { parseCard } from "@dat-poker/game-engine/card";
import {
  describeBestMadeHand,
  describeOmahaMadeHand,
} from "@dat-poker/game-engine/hand-evaluator";

export function describeLiveHand(
  hole: { rank: string; suit: string }[],
  board: { rank: string; suit: string }[] = [],
  variant?: string | null,
): string | null {
  if (hole.length === 0) return null;
  try {
    const holeCards = hole.map((c) => parseCard(`${c.rank}${c.suit}`));
    const boardCards = board.map((c) => parseCard(`${c.rank}${c.suit}`));
    const omaha = variant === "plo4" || variant === "plo5" || variant === "plo6" || hole.length >= 4;
    if (omaha) {
      return describeOmahaMadeHand(holeCards, boardCards);
    }
    return describeBestMadeHand([...holeCards, ...boardCards]);
  } catch {
    return null;
  }
}
