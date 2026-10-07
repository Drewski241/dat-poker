import { isHousePlayerId } from "./house-id.js";
import { chooseHouseAction } from "./house-strategy.js";
import type { NlheTableEngine } from "@dat-poker/game-engine";

export function playHouseIfDue(table: NlheTableEngine, random: () => number = Math.random): void {
  for (let i = 0; i < 16; i++) {
    const hand = table.getHandState();
    if (!hand || hand.actionSeat == null) {
      return;
    }
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
    if (!actor || !isHousePlayerId(actor.playerId)) {
      return;
    }
    const opponentsAllIn = hand.players
      .filter((p) => !isHousePlayerId(p.playerId) && !p.folded)
      .every((p) => p.allIn);
    const live = hand.players.filter((p) => !p.folded);
    const choice = chooseHouseAction(
      {
        street: hand.street,
        holeCards: actor.holeCards,
        board: hand.board,
        potMojos: hand.potMojos,
        currentBetMojos: hand.currentBetMojos,
        betThisStreetMojos: actor.betThisStreetMojos,
        stackMojos: actor.stackMojos,
        bigBlindMojos: table.getBigBlindMojos(),
        lastRaiseIncrementMojos: hand.lastRaiseIncrementMojos,
        opponentsAllIn,
        headsUp: live.length === 2,
      },
      random,
    );
    try {
      table.applyAction(actor.playerId, choice.action, choice.amountMojos);
    } catch {
      const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
      try {
        table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
      } catch {
        try {
          table.applyAction(actor.playerId, "fold");
        } catch {
          return;
        }
      }
    }
  }
}
