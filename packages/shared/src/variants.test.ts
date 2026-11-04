import { describe, expect, it } from "vitest";
import { getVariantMeta, POKER_VARIANTS } from "./variants.js";

describe("variants", () => {
  it("includes nlhe and calpoker", () => {
    expect(POKER_VARIANTS.length).toBeGreaterThan(5);
    expect(getVariantMeta("nlhe")?.bettingStructure).toBe("no-limit");
    expect(getVariantMeta("calpoker")?.chiaGamingNative).toBe(true);
    expect(POKER_VARIANTS.every((variant) => variant.headsUpViaChiaGaming)).toBe(true);
    expect(POKER_VARIANTS.filter((variant) => variant.chiaGamingNative).map((variant) => variant.id)).toEqual([
      "calpoker",
    ]);
  });
});
