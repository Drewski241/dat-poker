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

export type BigWinOverlay = "irish" | "hunter" | "hero";

const BIG_WIN_CYCLE: BigWinOverlay[] = ["irish", "hunter", "hero"];

const BIG_WIN_STORAGE_KEY = "dat-poker:last-big-win-overlay";

export function readStoredBigWinOverlay(): BigWinOverlay | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const value = sessionStorage.getItem(BIG_WIN_STORAGE_KEY);
    if (value === "irish" || value === "hunter" || value === "hero") return value;
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

/** Strictly cycle overlays (irish → hunter → hero → …), persisted per browser tab. */
export function pickBigWinOverlay(previous: BigWinOverlay | null): BigWinOverlay {
  const last = previous ?? readStoredBigWinOverlay();
  const idx = last ? BIG_WIN_CYCLE.indexOf(last) : -1;
  const next = BIG_WIN_CYCLE[(idx + 1) % BIG_WIN_CYCLE.length]!;
  storeBigWinOverlay(next);
  return next;
}
