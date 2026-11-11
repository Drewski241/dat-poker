import {
  chooseHouseAction,
  isHousePlayer,
  type HouseDecision,
  type NlheTableEngine,
  type PlayerAction,
} from "@dat-poker/game-engine";

export interface TakenHouseAction extends HouseDecision {
  playerId: string;
}

/** Apply the house policy until the seat belongs to someone else or the hand ends. */
export function runHouseTurn(table: NlheTableEngine): TakenHouseAction[] {
  const taken: TakenHouseAction[] = [];
  for (let i = 0; i < 40; i++) {
    const hand = table.getHandState();
    if (!hand || hand.actionSeat == null) break;
    const actor = hand.players.find(
      (player) => player.seatIndex === hand.actionSeat && !player.folded && !player.allIn,
    );
    if (!actor || !isHousePlayer(actor.playerId)) break;
    const decision = chooseHouseAction({
      street: hand.street,
      board: hand.board,
      holeCards: actor.holeCards,
      potMojos: hand.potMojos,
      currentBetMojos: hand.currentBetMojos,
      betThisStreetMojos: actor.betThisStreetMojos,
      stackMojos: actor.stackMojos,
      bigBlindMojos: table.getBigBlindMojos(),
    });
    const applied = applyOrFallback(table, actor.playerId, decision.action, decision.amountMojos, hand);
    taken.push({ playerId: actor.playerId, ...applied });
  }
  return taken;
}

function applyOrFallback(
  table: NlheTableEngine,
  playerId: string,
  action: PlayerAction,
  amountMojos: bigint,
  hand: NonNullable<ReturnType<NlheTableEngine["getHandState"]>>,
): HouseDecision {
  try {
    table.applyAction(playerId, action, amountMojos);
    return { action, amountMojos };
  } catch {
    const actor = hand.players.find((player) => player.playerId === playerId);
    const toCall = hand.currentBetMojos - (actor?.betThisStreetMojos ?? 0n);
    const fallback: PlayerAction = toCall <= 0n ? "check" : "call";
    try {
      table.applyAction(playerId, fallback, 0n);
      return { action: fallback, amountMojos: 0n };
    } catch {
      table.applyAction(playerId, "fold", 0n);
      return { action: "fold", amountMojos: 0n };
    }
  }
}
