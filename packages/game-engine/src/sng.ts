/** Six-max sit-and-go: one entry, one starting stack, blinds that climb every few hands. */

export const SNG_ENTRY_MOJOS = 1_000_000n;
export const SNG_STARTING_STACK_MOJOS = 1_500_000n;
export const SNG_HANDS_PER_LEVEL = 4;

/** Chip amounts use the same 1000-mojo unit as DAT, so 10_000 is 10 chips. */
const SNG_LEVELS: ReadonlyArray<readonly [bigint, bigint]> = [
  [10_000n, 20_000n],
  [15_000n, 30_000n],
  [25_000n, 50_000n],
  [50_000n, 100_000n],
  [75_000n, 150_000n],
  [100_000n, 200_000n],
  [150_000n, 300_000n],
  [200_000n, 400_000n],
  [300_000n, 600_000n],
  [500_000n, 1_000_000n],
];

export function sngBlinds(levelIndex: number): { smallBlindMojos: bigint; bigBlindMojos: bigint } {
  const index = Math.max(0, levelIndex);
  if (index < SNG_LEVELS.length) {
    const level = SNG_LEVELS[index];
    return { smallBlindMojos: level[0], bigBlindMojos: level[1] };
  }
  const last = SNG_LEVELS[SNG_LEVELS.length - 1];
  const factor = 2n ** BigInt(index - (SNG_LEVELS.length - 1));
  return { smallBlindMojos: last[0] * factor, bigBlindMojos: last[1] * factor };
}

export function sngLevelIndex(handsPlayed: number, handsPerLevel = SNG_HANDS_PER_LEVEL): number {
  if (handsPlayed <= 0) return 0;
  return Math.floor(handsPlayed / handsPerLevel);
}
