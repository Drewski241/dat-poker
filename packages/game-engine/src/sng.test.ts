import { describe, expect, it } from "vitest";
import { sngBlinds, sngLevelIndex, SNG_ENTRY_MOJOS, SNG_STARTING_STACK_MOJOS } from "./sng.js";

describe("sit-and-go blinds", () => {
  it("opens at 10/20 chips and climbs on the published schedule", () => {
    expect(sngBlinds(0)).toEqual({ smallBlindMojos: 10_000n, bigBlindMojos: 20_000n });
    expect(sngBlinds(1)).toEqual({ smallBlindMojos: 15_000n, bigBlindMojos: 30_000n });
    expect(sngBlinds(4)).toEqual({ smallBlindMojos: 75_000n, bigBlindMojos: 150_000n });
  });

  it("doubles the last level once the schedule is exhausted", () => {
    expect(sngBlinds(10)).toEqual({ smallBlindMojos: 1_000_000n, bigBlindMojos: 2_000_000n });
  });

  it("keeps level 1 for the first four hands", () => {
    expect(sngLevelIndex(0)).toBe(0);
    expect(sngLevelIndex(3)).toBe(0);
    expect(sngLevelIndex(4)).toBe(1);
  });

  it("prices a six-handed prize as six entries against a 1500-chip stack", () => {
    expect(SNG_ENTRY_MOJOS * 6n).toBe(6_000_000n);
    expect(SNG_STARTING_STACK_MOJOS).toBe(1_500_000n);
  });
});
