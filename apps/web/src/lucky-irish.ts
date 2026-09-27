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

/** Pots this many big blinds or larger count as a “big pot” (100 BB ≈ default min buy-in). */
export const LUCKY_IRISH_POT_BB = 100n;

function parsePotMojos(result: HandResult): bigint | null {
  try {
    const pot = BigInt(result.potMojos);
    return pot > 0n ? pot : null;
  } catch {
    return null;
  }
}

/** Won a large pot (by big-blind size), including fold wins with no hand shown. */
export function isBigPotCelebration(potMojos: bigint, bigBlindMojos: bigint): boolean {
  return bigBlindMojos > 0n && potMojos >= bigBlindMojos * LUCKY_IRISH_POT_BB;
}

/** Won at showdown with trips or better. */
export function isHighRankingShowdownCelebration(
  playerId: string,
  result: HandResult,
): boolean {
  if (result.reason !== "showdown") return false;
  const shown = result.shown?.find((row) => row.playerId === playerId);
  return Boolean(shown && LUCKY_IRISH_CATEGORIES.has(shown.category));
}

/** Show the big-win overlay only for a large pot or a strong made hand at showdown. */
export function shouldCelebrateBigWin(params: {
  playerId: string | null | undefined;
  result: HandResult | null | undefined;
  bigBlindMojos: bigint;
}): boolean {
  const { playerId, result, bigBlindMojos } = params;
  if (!playerId || !result) return false;
  if (result.winnerId !== playerId) return false;

  const pot = parsePotMojos(result);
  if (pot == null) return false;

  return (
    isBigPotCelebration(pot, bigBlindMojos) ||
    isHighRankingShowdownCelebration(playerId, result)
  );
}

/** @deprecated Use {@link shouldCelebrateBigWin}. */
export function isLuckyIrishWin(params: {
  playerId: string | null | undefined;
  result: HandResult | null | undefined;
  bigBlindMojos: bigint;
}): boolean {
  return shouldCelebrateBigWin(params);
}

export type BigWinOverlay = "irish" | "hunter";

const BIG_WIN_STORAGE_KEY = "dat-poker:last-big-win-overlay";

export function readStoredBigWinOverlay(): BigWinOverlay | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const value = sessionStorage.getItem(BIG_WIN_STORAGE_KEY);
    if (value === "irish" || value === "hunter") return value;
  } catch {
    /* private mode / blocked storage */
  }
  return null;
}

export function storeBigWinOverlay(overlay: BigWinOverlay): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(BIG_WIN_STORAGE_KEY, overlay);
  } catch {
    /* ignore */
  }
}

/** Strictly alternate overlays (irish → hunter → irish …), persisted per browser tab. */
export function pickBigWinOverlay(previous: BigWinOverlay | null): BigWinOverlay {
  const last = previous ?? readStoredBigWinOverlay();
  const next: BigWinOverlay = last === "irish" ? "hunter" : "irish";
  storeBigWinOverlay(next);
  return next;
}
