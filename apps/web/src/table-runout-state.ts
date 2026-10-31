import type { HandResult, HandState } from "./api.js";

/** All-in runout cinema is active only while we still have the hand result to animate. */
export function isRunoutCinemaActive(
  runoutFromBoardLen: number | null,
  handResult: HandResult | null,
): boolean {
  return runoutFromBoardLen != null && handResult != null;
}

/** Runout flag without a result (e.g. after MTT table relocation) blocks auto-deal forever unless cleared. */
export function shouldClearOrphanRunout(
  runoutFromBoardLen: number | null,
  handResult: HandResult | null,
  hand: HandState | null,
): boolean {
  return runoutFromBoardLen != null && handResult == null && hand == null;
}
