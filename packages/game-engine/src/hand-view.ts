import type { Card } from "./card.js";

/** Minimal hand shape shared by Hold'em, draw, and stud engines. */
export interface HandViewSource {
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
  players: Array<{
    playerId: string;
    seatIndex: number;
    holeCards: Card[];
    stackMojos: bigint;
    betThisStreetMojos: bigint;
    folded: boolean;
    allIn: boolean;
    /** Stud: indexes of face-up hole cards visible to everyone. */
    upCardIndexes?: number[];
    needsDiscard?: boolean;
    needsDraw?: boolean;
  }>;
}

export interface PublicHandPlayer {
  playerId: string;
  seatIndex: number;
  holeCards: Card[];
  holeCardCount: number;
  stackMojos: bigint;
  betThisStreetMojos: bigint;
  folded: boolean;
  allIn: boolean;
  needsDiscard?: boolean;
  needsDraw?: boolean;
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

/** Hand payload safe for a seated player: no deck, seeds, or other hidden hole cards. */
export function publicHandView(
  hand: HandViewSource | null,
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
      let holeCards: Card[] = [];
      if (visible) {
        holeCards = [...p.holeCards];
      } else if (p.upCardIndexes && p.upCardIndexes.length > 0) {
        // Stud: expose face-up cards to all viewers.
        holeCards = p.upCardIndexes
          .map((i) => p.holeCards[i])
          .filter((c): c is Card => c != null);
      }
      return {
        playerId: p.playerId,
        seatIndex: p.seatIndex,
        holeCards,
        holeCardCount: p.holeCards.length,
        stackMojos: p.stackMojos,
        betThisStreetMojos: p.betThisStreetMojos,
        folded: p.folded,
        allIn: p.allIn,
        needsDiscard: p.needsDiscard,
        needsDraw: p.needsDraw,
      };
    }),
  };
}
