export interface PotContestant {
  playerId: string;
  seatIndex: number;
  folded: boolean;
  contributed: bigint;
  /** Higher is better. Used only when more than one player contests a pot. */
  handScore: number;
}

export interface PotPayout {
  playerId: string;
  amountMojos: bigint;
}

/** Split each pot layer. Odd chips go to the first winner clockwise from the button. */
export function settlePots(players: PotContestant[], buttonSeat: number): PotPayout[] {
  const levels = [...new Set(players.map((player) => player.contributed))]
    .filter((level) => level > 0n)
    .sort((a, b) => (a < b ? -1 : 1));
  const awarded = new Map<string, bigint>();
  let previous = 0n;

  for (const level of levels) {
    let pot = 0n;
    for (const player of players) {
      const upper = player.contributed < level ? player.contributed : level;
      const lower = player.contributed < previous ? player.contributed : previous;
      pot += upper - lower;
    }
    const live = players.filter((player) => !player.folded && player.contributed >= level);
    if (live.length > 0 && pot > 0n) {
      const best = Math.max(...live.map((player) => player.handScore));
      const winners = clockwiseFrom(
        live.filter((player) => player.handScore === best),
        buttonSeat,
      );
      const share = pot / BigInt(winners.length);
      let remainder = pot - share * BigInt(winners.length);
      for (const winner of winners) {
        const extra = remainder > 0n ? 1n : 0n;
        if (extra === 1n) remainder -= 1n;
        awarded.set(winner.playerId, (awarded.get(winner.playerId) ?? 0n) + share + extra);
      }
    }
    previous = level;
  }

  return [...awarded.entries()].map(([playerId, amountMojos]) => ({ playerId, amountMojos }));
}

export function nextClockwise(seats: number[], from: number): number {
  const sorted = [...seats].sort((a, b) => a - b);
  return sorted.find((seat) => seat > from) ?? sorted[0];
}

function clockwiseFrom<T extends { seatIndex: number }>(players: T[], buttonSeat: number): T[] {
  return [...players].sort((a, b) => distance(a.seatIndex, buttonSeat) - distance(b.seatIndex, buttonSeat));
}

function distance(seat: number, buttonSeat: number): number {
  const delta = seat - buttonSeat;
  return delta > 0 ? delta : delta + 100;
}
