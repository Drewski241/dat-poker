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

/** Won a large pot (by big-blind size). Fold/uncalled pots use a separate gate. */
export function isBigPotCelebration(potMojos: bigint, bigBlindMojos: bigint): boolean {
  return bigBlindMojos > 0n && potMojos >= bigBlindMojos * LUCKY_IRISH_POT_BB;
}

/** Someone was all-in and the hand went to showdown (a call, not an uncalled shove). */
export function isContestedAllInShowdown(result: HandResult): boolean {
  if (result.reason !== "showdown") return false;
  if ((result.allInPlayerIds?.length ?? 0) > 0) return true;
  if (typeof result.runoutFromBoardLen === "number") return true;
  return Boolean(result.shown?.some((row) => row.allIn));
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

/**
 * Big-win overlay: large contested all-in pots, or a strong made hand at showdown.
 * Uncalled all-ins (fold wins) never celebrate — wait for a call and the river.
 */
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

  if (isHighRankingShowdownCelebration(playerId, result)) return true;

  return isContestedAllInShowdown(result) && isBigPotCelebration(pot, bigBlindMojos);
}

/** Hold celebration until the all-in cinema (through river / hands) is done. */
export function shouldDeferBigWinForRunout(params: {
  result: HandResult | null | undefined;
  runoutPlaying: boolean;
  willPlayRunout: boolean;
}): boolean {
  if (params.runoutPlaying) return true;
  if (!params.result) return false;
  return params.willPlayRunout;
}

/** @deprecated Use {@link shouldCelebrateBigWin}. */
export function isLuckyIrishWin(params: {
  playerId: string | null | undefined;
  result: HandResult | null | undefined;
  bigBlindMojos: bigint;
}): boolean {
  return shouldCelebrateBigWin(params);
}

export type BigWinOverlay =
  | "irish"
  | "hunter"
  | "hero"
  | "sloth"
  | "terrier"
  | "owl"
  | "vault"
  | "fireworks"
  | "pinata"
  | "ufo"
  | "belt";

export const BIG_WIN_CYCLE: BigWinOverlay[] = [
  "irish",
  "hunter",
  "hero",
  "sloth",
  "terrier",
  "owl",
  "vault",
  "fireworks",
  "pinata",
  "ufo",
  "belt",
];

const BIG_WIN_STORAGE_KEY = "dat-poker:last-big-win-overlay";

function isBigWinOverlay(value: string): value is BigWinOverlay {
  return (BIG_WIN_CYCLE as readonly string[]).includes(value);
}

export function readStoredBigWinOverlay(): BigWinOverlay | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const value = sessionStorage.getItem(BIG_WIN_STORAGE_KEY);
    if (value && isBigWinOverlay(value)) return value;
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

/** Strictly cycle overlays, persisted per browser tab. */
export function pickBigWinOverlay(previous: BigWinOverlay | null): BigWinOverlay {
  const last = previous ?? readStoredBigWinOverlay();
  const idx = last ? BIG_WIN_CYCLE.indexOf(last) : -1;
  const next = BIG_WIN_CYCLE[(idx + 1) % BIG_WIN_CYCLE.length]!;
  storeBigWinOverlay(next);
  return next;
}

const BIG_WIN_PREVIEW_HASH: Record<string, BigWinOverlay> = {
  "#lucky": "irish",
  "#hunter": "hunter",
  "#hero": "hero",
  "#big-sloth": "sloth",
  "#big-terrier": "terrier",
  "#big-owl": "owl",
  "#big-vault": "vault",
  "#big-fireworks": "fireworks",
  "#big-pinata": "pinata",
  "#big-ufo": "ufo",
  "#big-belt": "belt",
};

/** Dev preview via location hash (e.g. `#big-sloth`). */
export function parseBigWinPreviewHash(hash: string): BigWinOverlay | null {
  return BIG_WIN_PREVIEW_HASH[hash] ?? null;
}
