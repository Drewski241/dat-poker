/**
 * Independent Chip Model (Malmuth–Harville) equity for tournament stacks.
 *
 * Given chip stacks and a prize ladder, returns each player's expected prize
 * value assuming finishing order is proportional to chip share at each step.
 */

export interface IcmPlayerInput {
  playerId: string;
  stackMojos: bigint;
}

export interface IcmResult {
  playerId: string;
  equityMojos: bigint;
  /** Equity as fraction of total prize pool (0..1). */
  equityPct: number;
}

function stacksToNumbers(stacks: bigint[]): number[] {
  return stacks.map((s) => Number(s));
}

/**
 * Recursive ICM: probability player i finishes in each place, times prizes.
 * Exact for small fields (≤ ~10); for larger fields use truncated depth.
 */
export function computeIcm(
  players: readonly IcmPlayerInput[],
  prizes: readonly bigint[],
): IcmResult[] {
  if (players.length === 0) return [];
  const n = players.length;
  const prizeCount = Math.min(prizes.length, n);
  const padded = Array.from({ length: n }, (_, i) =>
    i < prizeCount ? prizes[i]! : 0n,
  );
  const stacks = stacksToNumbers(players.map((p) => p.stackMojos));
  const total = stacks.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return players.map((p) => ({
      playerId: p.playerId,
      equityMojos: 0n,
      equityPct: 0,
    }));
  }

  const equities = new Array(n).fill(0);

  function recurse(
    alive: number[],
    place: number,
    prob: number,
  ): void {
    if (alive.length === 1) {
      equities[alive[0]!] += prob * Number(padded[place]!);
      return;
    }
    if (place >= n) return;

    const chipSum = alive.reduce((a, i) => a + stacks[i]!, 0);
    if (chipSum <= 0) return;

    for (const i of alive) {
      const pBust = stacks[i]! / chipSum;
      if (pBust <= 0) continue;
      equities[i] += prob * pBust * Number(padded[place]!);
      const next = alive.filter((x) => x !== i);
      recurse(next, place + 1, prob * pBust);
    }
  }

  recurse(
    Array.from({ length: n }, (_, i) => i),
    0,
    1,
  );

  const pool = padded.reduce((a, b) => a + b, 0n);
  const poolNum = Number(pool) || 1;

  return players.map((p, i) => {
    const equityMojos = BigInt(Math.round(equities[i]!));
    return {
      playerId: p.playerId,
      equityMojos,
      equityPct: equities[i]! / poolNum,
    };
  });
}
