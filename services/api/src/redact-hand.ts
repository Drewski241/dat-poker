/** Redact private cards / seeds for a viewer while keeping betting metadata. */
export function redactHandForViewer(hand: unknown, viewerId: string | undefined): unknown {
  if (!hand || typeof hand !== "object") return null;
  const h = hand as {
    players: Array<{
      playerId: string;
      holeCards: unknown[];
      upCardIndexes?: number[];
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  return {
    ...h,
    serverSeed: null,
    deck: [],
    playerSeeds: {},
    players: h.players.map((p) => {
      const visible = p.playerId === viewerId;
      let holeCards: unknown[] = visible ? p.holeCards : [];
      if (!visible && p.upCardIndexes && p.upCardIndexes.length > 0) {
        holeCards = p.upCardIndexes.map((i) => p.holeCards[i]).filter((c) => c != null);
      }
      return {
        ...p,
        holeCards,
        holeCardCount: p.holeCards.length,
      };
    }),
  };
}
