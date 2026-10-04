import { parseCard } from "@dat-poker/game-engine/card";
import { describeBestMadeHand } from "@dat-poker/game-engine/hand-evaluator";

export function describeLiveHand(
  hole: { rank: string; suit: string }[],
  board: { rank: string; suit: string }[] = [],
): string | null {
  if (hole.length === 0) return null;
  try {
    const cards = [...hole, ...board].map((c) => parseCard(`${c.rank}${c.suit}`));
    return describeBestMadeHand(cards);
  } catch {
    return null;
  }
}
