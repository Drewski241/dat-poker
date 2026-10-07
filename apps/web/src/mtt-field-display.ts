import type { SngSnapshot } from "./api.js";

/** Sanitized MTT field counts for UI (guards bad/stale API values). */
export function mttFieldCounts(sng: SngSnapshot): {
  inField: number;
  atOtherTable: number | null;
} {
  const cap = sng.fieldSize ?? 16;
  const atThisTable = sng.playersRemaining ?? 0;
  const rawOther = sng.otherTablePlayers;
  const rawField = sng.eventPlayersRemaining;

  let inField = rawField ?? atThisTable + (rawOther ?? 0);
  if (!Number.isFinite(inField) || inField > cap || inField < 0) {
    inField = Math.min(cap, atThisTable + (rawOther ?? 0));
  }

  let atOtherTable: number | null = rawOther ?? null;
  if (atOtherTable != null && (atOtherTable > cap || atOtherTable < 0)) {
    atOtherTable = Math.max(0, Math.min(cap, inField - atThisTable));
  }

  return { inField, atOtherTable };
}

export function mttRedrawBlocked(
  sng: SngSnapshot | null | undefined,
  lastError: string | null | undefined,
): boolean {
  if (!sng) return false;
  if (sng.status !== "running") return sng.status === "registering";
  return Boolean(
    sng.pauseDeals ||
      sng.pendingFinalTable ||
      (lastError && lastError.includes("Waiting to redraw")),
  );
}
