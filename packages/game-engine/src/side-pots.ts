import type { PlayerId } from "@dat-poker/shared";

export interface SidePotContribution {
  playerId: PlayerId;
  totalBetHandMojos: bigint;
}

export interface SidePot {
  amountMojos: bigint;
  /** Players who contributed at least this pot's level (includes folded players). */
  eligiblePlayerIds: PlayerId[];
}

/** Layer total bets into main and side pots (standard NLHE settlement). */
export function buildSidePots(contributions: SidePotContribution[]): SidePot[] {
  const withBets = contributions.filter((c) => c.totalBetHandMojos > 0n);
  if (withBets.length === 0) return [];

  const levels = [...new Set(withBets.map((c) => c.totalBetHandMojos))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const pots: SidePot[] = [];
  let previousLevel = 0n;

  for (const level of levels) {
    const eligible = withBets.filter((c) => c.totalBetHandMojos >= level).map((c) => c.playerId);
    const layer = level - previousLevel;
    const amountMojos = layer * BigInt(eligible.length);
    if (amountMojos > 0n) {
      pots.push({ amountMojos, eligiblePlayerIds: eligible });
    }
    previousLevel = level;
  }

  return pots;
}

export function splitPotEvenly(amountMojos: bigint, winnerCount: number): bigint[] {
  if (winnerCount <= 0) return [];
  const n = BigInt(winnerCount);
  const base = amountMojos / n;
  const remainder = amountMojos % n;
  const shares: bigint[] = [];
  for (let i = 0; i < winnerCount; i++) {
    shares.push(base + (BigInt(i) < remainder ? 1n : 0n));
  }
  return shares;
}
