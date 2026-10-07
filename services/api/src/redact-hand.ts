import type { TableHandState } from "@dat-poker/game-engine";

export function redactHandForViewer(
  hand: TableHandState | null,
  viewerId: string | undefined,
): TableHandState | null {
  if (!hand) {
    return null;
  }
  return {
    ...hand,
    serverSeed: null,
    deck: [],
    playerSeeds: {},
    players: hand.players.map((p) => ({
      ...p,
      holeCards: p.playerId === viewerId ? p.holeCards : [],
    })),
  };
}
