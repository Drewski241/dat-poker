import { describe, expect, it } from "vitest";
import {
  actionSecondsRemaining,
  actionTimedOut,
  PLAYER_ACTION_LIMIT_MS,
  shouldShowSloth,
  SLOTH_APPEAR_DELAY_MS,
} from "./player-turn-timer.js";

describe("player turn timer", () => {
  it("gives 30 seconds and shows the sloth only after 15 seconds", () => {
    expect(SLOTH_APPEAR_DELAY_MS).toBe(15_000);
    expect(PLAYER_ACTION_LIMIT_MS).toBe(30_000);
    expect(SLOTH_APPEAR_DELAY_MS).toBeLessThan(PLAYER_ACTION_LIMIT_MS);
  });

  it("counts down seconds remaining in the action window", () => {
    expect(actionSecondsRemaining(0)).toBe(30);
    expect(actionSecondsRemaining(14_999)).toBe(16);
    expect(actionSecondsRemaining(15_000)).toBe(15);
    expect(actionSecondsRemaining(29_500)).toBe(1);
    expect(actionSecondsRemaining(30_000)).toBe(0);
  });

  it("hides the sloth for the first 15 seconds of a turn", () => {
    expect(shouldShowSloth(0, true)).toBe(false);
    expect(shouldShowSloth(14_999, true)).toBe(false);
    expect(shouldShowSloth(15_000, true)).toBe(true);
    expect(shouldShowSloth(20_000, false)).toBe(false);
  });

  it("marks timeout at 30 seconds", () => {
    expect(actionTimedOut(29_999)).toBe(false);
    expect(actionTimedOut(30_000)).toBe(true);
  });
});
