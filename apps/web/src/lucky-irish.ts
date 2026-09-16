import type { HandResult } from "./api.js";

/** Trips or better — a “big hand,” not just any showdown win. */
export const LUCKY_IRISH_CATEGORIES = new Set([
  "three_kind",
  "straight",
  "flush",
  "full_house",
  "four_kind",
  "straight_flush",
]);

/** Pots this many big blinds or larger also count as a big win. */
export const LUCKY_IRISH_POT_BB = 20n;

export function isLuckyIrishWin(params: {
  playerId: string | null | undefined;
  result: HandResult | null | undefined;
  bigBlindMojos: bigint;
}): boolean {
  const { playerId, result, bigBlindMojos } = params;
  if (!playerId || !result) return false;
  if (result.winnerId !== playerId) return false;

  let pot = 0n;
  try {
    pot = BigInt(result.potMojos);
  } catch {
    return false;
  }
  if (pot <= 0n) return false;

  if (bigBlindMojos > 0n && pot >= bigBlindMojos * LUCKY_IRISH_POT_BB) {
    return true;
  }

  const shown = result.shown?.find((row) => row.playerId === playerId);
  return Boolean(shown && LUCKY_IRISH_CATEGORIES.has(shown.category));
}

export type BigWinOverlay = "irish" | "hunter";

/** Alternate overlays so consecutive big wins are not the same graphic. */
export function pickBigWinOverlay(
  previous: BigWinOverlay | null,
  random: () => number = Math.random,
): BigWinOverlay {
  if (previous === "irish") return "hunter";
  if (previous === "hunter") return "irish";
  return random() < 0.5 ? "irish" : "hunter";
}
