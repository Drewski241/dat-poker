import type { Card } from "./card.js";
import type { TableHandState } from "./nlhe-table.js";

export interface PublicHandPlayer {
  playerId: string;
  seatIndex: number;
  holeCards: Card[];
  holeCardCount: number;
  stackMojos: bigint;
  betThisStreetMojos: bigint;
  folded: boolean;
  allIn: boolean;
}

export interface PublicHandState {
  handId: string;
  tableId: string;
  street: string;
  board: Card[];
  potMojos: bigint;
  currentBetMojos: bigint;
  dealerSeat: number;
  actionSeat: number | null;
  seq: number;
  commitHash: string;
  players: PublicHandPlayer[];
}

/** Hand payload safe for a seated player: no deck, seeds, or other hole cards. */
export function publicHandView(
  hand: TableHandState | null,
  viewerId?: string | null,
): PublicHandState | null {
  if (!hand) return null;
  return {
    handId: hand.handId,
    tableId: hand.tableId,
    street: hand.street,
    board: [...hand.board],
    potMojos: hand.potMojos,
    currentBetMojos: hand.currentBetMojos,
    dealerSeat: hand.dealerSeat,
    actionSeat: hand.actionSeat,
    seq: hand.seq,
    commitHash: hand.commitHash,
    players: hand.players.map((p) => {
      const visible = p.playerId === viewerId;
      return {
        playerId: p.playerId,
        seatIndex: p.seatIndex,
        holeCards: visible ? [...p.holeCards] : [],
        holeCardCount: p.holeCards.length,
        stackMojos: p.stackMojos,
        betThisStreetMojos: p.betThisStreetMojos,
        folded: p.folded,
        allIn: p.allIn,
      };
    }),
  };
}
