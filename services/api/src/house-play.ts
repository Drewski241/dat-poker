import { isHousePlayerId } from "./house-id.js";
import { chooseHouseAction } from "./house-strategy.js";
import type { TableEngine } from "@dat-poker/game-engine";
import {
  isDrawFamilyVariant,
  isPineappleVariant,
} from "@dat-poker/shared";

export function playHouseIfDue(table: TableEngine, random: () => number = Math.random): void {
  for (let i = 0; i < 16; i++) {
    const hand = table.getHandState();
    if (!hand || hand.actionSeat == null) {
      return;
    }
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
    if (!actor || !isHousePlayerId(actor.playerId)) {
      return;
    }

    const variant = table.getConfig().variant;
    const needsDiscard =
      ("needsDiscard" in actor && Boolean(actor.needsDiscard)) ||
      (isPineappleVariant(variant) && hand.street === "discard");
    const needsDraw =
      ("needsDraw" in actor && Boolean(actor.needsDraw)) ||
      (isDrawFamilyVariant(variant) && String(hand.street).startsWith("draw"));

    if (needsDiscard || needsDraw) {
      try {
        // Stand pat / discard first hole card for pineapple.
        if ("applyDiscard" in table && typeof table.applyDiscard === "function") {
          const indexes = needsDiscard && actor.holeCards.length > 2 ? [0] : [];
          table.applyDiscard(actor.playerId, indexes);
        } else {
          table.applyAction(actor.playerId, "discard", 0n);
        }
      } catch {
        return;
      }
      continue;
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
        variant,
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
