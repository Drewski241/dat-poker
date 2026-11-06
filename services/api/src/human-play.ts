import { PLAYER_ACTION_LIMIT_MS } from "@dat-poker/shared";
import type { TableEngine } from "@dat-poker/game-engine";
import { isDrawFamilyVariant, isPineappleVariant } from "@dat-poker/shared";
import { isHousePlayerId } from "./house-id.js";

const turnStarted = new Map<string, { key: string; startedMs: number }>();

function turnKey(hand: {
  handId: string;
  actionSeat: number | null;
  street: string;
  currentBetMojos: bigint;
  seq: number;
}): string {
  return `${hand.handId}:${hand.actionSeat}:${hand.street}:${hand.currentBetMojos}:${hand.seq}`;
}

function autoAction(
  table: TableEngine,
  playerId: string,
): "check" | "fold" | "discard" {
  const hand = table.getHandState();
  if (!hand) return "fold";
  const me = hand.players.find((p) => p.playerId === playerId);
  if (!me) return "fold";
  const variant = table.getConfig().variant;
  const needsDiscard =
    ("needsDiscard" in me && Boolean(me.needsDiscard)) ||
    (isPineappleVariant(variant) && hand.street === "discard");
  const needsDraw =
    ("needsDraw" in me && Boolean(me.needsDraw)) ||
    (isDrawFamilyVariant(variant) && String(hand.street).startsWith("draw"));
  if (needsDiscard || needsDraw) return "discard";
  const toCall = hand.currentBetMojos - me.betThisStreetMojos;
  return toCall <= 0n ? "check" : "fold";
}

export function resetHumanTurnClockForTests(): void {
  turnStarted.clear();
}

/**
 * Auto-check/fold for humans who timed out or are sitting out, so tables keep moving
 * when only one client is polling (SNG/MTT/cash).
 */
export function playHumansIfDue(
  tableId: string,
  table: TableEngine,
  nowMs: number = Date.now(),
): void {
  for (let i = 0; i < 24; i++) {
    const hand = table.getHandState();
    if (!hand || hand.actionSeat == null) {
      return;
    }
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
    if (!actor || isHousePlayerId(actor.playerId) || actor.allIn) {
      return;
    }

    const key = turnKey(hand);
    let clock = turnStarted.get(tableId);
    if (!clock || clock.key !== key) {
      clock = { key, startedMs: nowMs };
      turnStarted.set(tableId, clock);
    }

    const sittingOut = table.isSittingOut(actor.playerId);
    const timedOut = nowMs - clock.startedMs >= PLAYER_ACTION_LIMIT_MS;
    if (!sittingOut && !timedOut) {
      return;
    }

    const action = autoAction(table, actor.playerId);
    try {
      if (action === "discard" && "applyDiscard" in table && typeof table.applyDiscard === "function") {
        const indexes =
          "needsDiscard" in actor && actor.needsDiscard && actor.holeCards.length > 2 ? [0] : [];
        table.applyDiscard(actor.playerId, indexes);
      } else {
        table.applyAction(actor.playerId, action);
      }
    } catch {
      return;
    }
    if (timedOut && !sittingOut) {
      try {
        table.markTimedOutSittingOut(actor.playerId);
      } catch {
        /* seat may have busted */
      }
    }
    table.advanceHandIfIdle();
  }
}
