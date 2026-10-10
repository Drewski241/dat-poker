import { isHousePlayerId, type HousePolicy } from "@dat-poker/shared";
import { createHash } from "node:crypto";
import type { PlayerAction, TableHandState } from "./nlhe-table.js";
import { NlheTableEngine } from "./nlhe-table.js";

export interface HouseDecision {
  action: PlayerAction;
  amountMojos?: bigint;
}

export function chooseHouseAction(
  hand: TableHandState,
  playerId: string,
  policy: HousePolicy,
  bigBlindMojos: bigint,
): HouseDecision {
  const player = hand.players.find((p) => p.playerId === playerId);
  if (!player) {
    throw new Error("House actor not in hand");
  }
  const toCall = hand.currentBetMojos - player.betThisStreetMojos;
  const canCheck = toCall <= 0n;

  if (policy === "folding") {
    return canCheck ? { action: "check" } : { action: "fold" };
  }
  if (policy === "passive") {
    if (canCheck) return { action: "check" };
    return { action: "call" };
  }

  const roll = houseRoll(playerId, hand.handId, hand.street, hand.seq);
  const short = player.stackMojos <= bigBlindMojos * 5n;

  if (canCheck) {
    if (roll < 0.78) return { action: "check" };
    const minBet = bigBlindMojos > player.stackMojos ? player.stackMojos : bigBlindMojos;
    if (minBet <= 0n) return { action: "check" };
    if (minBet === player.stackMojos) return { action: "all-in" };
    return { action: "bet", amountMojos: minBet };
  }

  if (short && roll < 0.45) return { action: "all-in" };
  if (roll < 0.58) return { action: "fold" };
  if (roll < 0.9 || player.stackMojos <= toCall) return { action: "call" };

  const raiseTo = hand.currentBetMojos + bigBlindMojos;
  const maxTo = player.betThisStreetMojos + player.stackMojos;
  if (raiseTo >= maxTo) return { action: "all-in" };
  return { action: "raise", amountMojos: raiseTo };
}

export function playHouseUntilHuman(
  engine: NlheTableEngine,
  policy: HousePolicy,
  maxActions = 400,
): void {
  const bigBlind = engine.getConfig().bigBlindMojos;
  for (let i = 0; i < maxActions; i++) {
    const hand = engine.getHandState();
    if (!hand) return;
    const actorId = engine.actorPlayerId();
    if (!actorId || !isHousePlayerId(actorId)) return;
    const decision = chooseHouseAction(hand, actorId, policy, bigBlind);
    try {
      engine.applyAction(actorId, decision.action, decision.amountMojos ?? 0n);
    } catch {
      const latest = engine.getHandState();
      const actor = latest?.players.find((p) => p.playerId === actorId);
      const toCall = latest && actor ? latest.currentBetMojos - actor.betThisStreetMojos : 0n;
      try {
        engine.applyAction(actorId, toCall > 0n ? "call" : "check");
      } catch {
        engine.applyAction(actorId, "fold");
      }
    }
  }
}

function houseRoll(playerId: string, handId: string, street: string, seq: number): number {
  const digest = createHash("sha256").update(`${playerId}|${handId}|${street}|${seq}`).digest();
  return digest[0]! / 255;
}
