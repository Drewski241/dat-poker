import { randomUUID } from "node:crypto";
import {
  generateServerSeed,
  type MttEvent,
  type NlheTableEngine,
  type SngTournament,
} from "@dat-poker/game-engine";
import { tableHasLivingHuman } from "./mtt-house-advance.js";
import { playHouseIfDue } from "./house-play.js";
import { playHumansIfDue } from "./human-play.js";

/**
 * After MTT/SNG final-table relocation, start the first deal on poll so clients
 * stuck with a stale runout/cinema flag are not the only path that can deal.
 *
 * Scoped to final tables only — ordinary registering/running tables still rely
 * on client auto-deal so tests and cash-out flows are not interrupted.
 */
export function maybeDealTournamentHandOnPoll(
  tableId: string,
  table: NlheTableEngine,
  mtt: MttEvent | undefined,
  sng: SngTournament | undefined,
  hooks: {
    onHandStarted: () => void;
    afterDeal: () => void;
  },
): boolean {
  if (!mtt && !sng) return false;
  if (table.isHandInProgress()) return false;
  if (table.getLastHandResult() != null) return false;
  if (table.activeSeatedPlayers().length < 2) return false;
  if (!tableHasLivingHuman(table)) return false;

  const status = sng?.getStatus() ?? mtt?.getStatus();
  if (status !== "running") return false;
  if (mtt?.shouldPauseDeals(tableId)) return false;

  // Single-table SNGs never relocate; only MTT final tables need this kick.
  if (!mtt) return false;
  const snap = mtt.snapshot(tableId);
  if (!snap.isFinalTable) return false;

  try {
    hooks.onHandStarted();
    table.startHand(randomUUID());
    for (const seated of table.getSeatedPlayers()) {
      if (seated.sittingOut) continue;
      table.submitPlayerSeed(seated.playerId, generateServerSeed());
    }
    table.revealAndDeal();
    table.advanceHandIfIdle();
    playHumansIfDue(tableId, table);
    playHouseIfDue(table);
    hooks.afterDeal();
    return true;
  } catch {
    return false;
  }
}
