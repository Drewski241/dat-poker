/** Row indices 0=top, 1=middle, 2=bottom for each of 5 reels. */
export const PAYLINE_COUNT = 9;

export const PAYLINE_NAMES: readonly string[] = [
  "Line 1 · Center row",
  "Line 2 · Top row",
  "Line 3 · Bottom row",
  "Line 4 · V down",
  "Line 5 · V up",
  "Line 6 · Zig down",
  "Line 7 · Zig up",
  "Line 8 · W top",
  "Line 9 · W bottom",
];

export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
];
