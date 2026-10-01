import type { BlindLevel } from "@dat-poker/shared";
import { CAT_MOJOS_PER_TOKEN } from "@dat-poker/shared";

/** Standard MTT-style blind ladder in DAT CAT mojos (1000 mojos = 1 DAT). */
export function defaultMttBlindLevels(
  startingBigBlindMojos: bigint = 20n * CAT_MOJOS_PER_TOKEN,
): BlindLevel[] {
  const levels: BlindLevel[] = [];
  let bb = startingBigBlindMojos;
  for (let level = 0; level < 20; level++) {
    levels.push({
      level,
      smallBlindMojos: bb / 2n,
      bigBlindMojos: bb,
      anteMojos: level >= 5 ? bb / 5n : 0n,
      durationSeconds: 600,
    });
    bb = bb * 2n;
  }
  return levels;
}

/** Short SNG ladder (faster levels). */
export function defaultSngBlindLevels(
  startingBigBlindMojos: bigint = 20n * CAT_MOJOS_PER_TOKEN,
): BlindLevel[] {
  return defaultMttBlindLevels(startingBigBlindMojos).map((l) => ({
    ...l,
    durationSeconds: 300,
  }));
}
