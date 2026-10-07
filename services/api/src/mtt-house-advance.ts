import { randomUUID } from "node:crypto";
import { generateServerSeed, type MttEvent, type NlheTableEngine } from "@dat-poker/game-engine";
import { isHousePlayerId } from "./house-id.js";
import { playHouseIfDue } from "./house-play.js";

/** Cap catch-up hands per request so HTTP polls stay responsive. */
const MAX_CATCHUP_HANDS_PER_CALL = 4;
const MAX_HOUSE_ACTION_BURSTS = 48;

export function tableHasLivingHuman(engine: NlheTableEngine): boolean {
  return engine
    .getSeatedPlayers()
    .some((p) => p.stackMojos > 0n && !isHousePlayerId(p.playerId));
}

/**
 * Finish the current hand if one is open (house-only), otherwise deal a full
 * house-vs-house hand. Returns true when a hand completed during this call.
 */
export function completeHouseOnlyHand(
  table: NlheTableEngine,
  onHandStarted?: () => void,
  random: () => number = Math.random,
): boolean {
  if (tableHasLivingHuman(table)) {
    return false;
  }
  if (table.getActivePlayerCount() < 2) {
    return false;
  }

  if (!table.isHandInProgress()) {
    onHandStarted?.();
    table.startHand(randomUUID());
    for (const seated of table.getSeatedPlayers()) {
      table.submitPlayerSeed(seated.playerId, generateServerSeed());
    }
    table.revealAndDeal();
    table.advanceHandIfIdle();
  }

  for (let i = 0; i < MAX_HOUSE_ACTION_BURSTS; i += 1) {
    if (!table.isHandInProgress()) {
      return true;
    }
    const before = table.getHandState()?.seq;
    playHouseIfDue(table, random);
    table.advanceHandIfIdle();
    if (!table.isHandInProgress()) {
      return true;
    }
    const after = table.getHandState()?.seq;
    if (after === before) {
      // Stuck waiting on a non-house actor — should not happen on house-only tables.
      return false;
    }
  }
  return !table.isHandInProgress();
}

export interface AdvanceSiblingOptions {
  maxHands?: number;
  random?: () => number;
  /** Called after each sibling hand completes (e.g. afterHand + register tables). */
  onHandComplete: (tableId: string) => void;
  onHandStarted: (tableId: string) => void;
}

export interface ClearMttRedrawPauseOptions {
  random?: () => number;
  onHandComplete: (tableId: string) => void;
}

/**
 * While deals are paused for table balance / final-table formation, finish any
 * idle house-only hands blocking maintain() and sync the blind clock.
 */
function finishOrAbortHouseOnlyHand(
  engine: NlheTableEngine,
  options: ClearMttRedrawPauseOptions,
  tableId: string,
): void {
  if (!engine.isHandInProgress() || tableHasLivingHuman(engine)) return;
  const random = options.random ?? Math.random;
  for (let burst = 0; burst < MAX_HOUSE_ACTION_BURSTS; burst += 1) {
    if (!engine.isHandInProgress()) break;
    const finished = completeHouseOnlyHand(engine, undefined, random);
    if (finished) {
      options.onHandComplete(tableId);
      return;
    }
  }
  if (engine.isHandInProgress()) {
    engine.abortHandRefundBets();
    options.onHandComplete(tableId);
  }
}

export function clearMttRedrawPause(
  mtt: MttEvent,
  triggerTableId: string,
  options: ClearMttRedrawPauseOptions,
): void {
  if (mtt.getStatus() !== "running") return;
  if (!mtt.hasTable(triggerTableId)) return;
  if (!mtt.shouldPauseDeals(triggerTableId)) return;

  for (const tableId of mtt.openTableIds()) {
    const engine = mtt.engineFor(tableId);
    if (!engine) continue;
    finishOrAbortHouseOnlyHand(engine, options, tableId);
  }
  mtt.syncBlindClock();
}

/** Drop orphan house-only hands that block redraw (even before the human table has dealt). */
export function healOrphanHouseHands(
  mtt: MttEvent,
  triggerTableId: string,
  options: ClearMttRedrawPauseOptions,
): void {
  if (mtt.getStatus() !== "running") return;
  if (!mtt.hasTable(triggerTableId)) return;
  for (const tableId of mtt.openTableIds()) {
    if (tableId === triggerTableId) continue;
    const engine = mtt.engineFor(tableId);
    if (!engine) continue;
    finishOrAbortHouseOnlyHand(engine, options, tableId);
  }
}

/**
 * When a human (or any trigger table) advances, deal/play house-only sibling
 * tables until their hand count catches up — same pace, no idle starting stacks.
 */
export function advanceSiblingMttHouseTables(
  mtt: MttEvent,
  triggerTableId: string,
  options: AdvanceSiblingOptions,
): number {
  if (mtt.getStatus() !== "running") return 0;
  if (!mtt.hasTable(triggerTableId)) return 0;

  const targetHands = mtt.handsDealtAt(triggerTableId);
  if (targetHands <= 0) {
    healOrphanHouseHands(mtt, triggerTableId, {
      random: options.random,
      onHandComplete: options.onHandComplete,
    });
    return 0;
  }

  const maxHands = options.maxHands ?? MAX_CATCHUP_HANDS_PER_CALL;
  const random = options.random ?? Math.random;
  let completed = 0;

  for (const tableId of mtt.openTableIds()) {
    if (tableId === triggerTableId) continue;
    if (completed >= maxHands) break;

    const engine = mtt.engineFor(tableId);
    if (!engine || tableHasLivingHuman(engine)) continue;

    while (completed < maxHands && mtt.getStatus() === "running") {
      const needsFinish = engine.isHandInProgress();
      const needsDeal =
        !needsFinish &&
        mtt.handsDealtAt(tableId) < targetHands &&
        !mtt.shouldPauseDeals(tableId);
      if (!needsFinish && !needsDeal) break;

      const finished = completeHouseOnlyHand(
        engine,
        needsDeal ? () => options.onHandStarted(tableId) : undefined,
        random,
      );
      if (!finished) break;
      options.onHandComplete(tableId);
      completed += 1;
      if (!mtt.openTableIds().includes(tableId)) break;
    }
  }

  return completed;
}
