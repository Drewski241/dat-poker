import { describe, expect, it } from "vitest";
import {
  getVariantMeta,
  isDrawFamilyVariant,
  isOmahaHiLoVariant,
  isPineappleVariant,
  isStudFamilyVariant,
  normalizePokerVariant,
  POKER_VARIANTS,
} from "./variants.js";

describe("variants", () => {
  it("includes nlhe and calpoker", () => {
    expect(POKER_VARIANTS.length).toBeGreaterThan(5);
    expect(getVariantMeta("nlhe")?.bettingStructure).toBe("no-limit");
    expect(getVariantMeta("calpoker")?.chiaGamingNative).toBe(true);
  });

  it("catalogs draw, stud, pineapple, and omaha hi/lo families", () => {
    expect(isDrawFamilyVariant("five_card_draw")).toBe(true);
    expect(isDrawFamilyVariant("triple_draw_27")).toBe(true);
    expect(isDrawFamilyVariant("badugi")).toBe(true);
    expect(isStudFamilyVariant("seven_card_stud")).toBe(true);
    expect(isStudFamilyVariant("razz")).toBe(true);
    expect(isPineappleVariant("crazy_pineapple")).toBe(true);
    expect(isOmahaHiLoVariant("plo4_hl")).toBe(true);
    expect(getVariantMeta("triple_draw_27")?.drawRounds).toBe(3);
    expect(getVariantMeta("badugi")?.holeCards).toBe(4);
  });

  it("normalizes common aliases", () => {
    expect(normalizePokerVariant("plo")).toBe("plo4");
    expect(normalizePokerVariant("2-7")).toBe("triple_draw_27");
    expect(normalizePokerVariant("omaha hi/lo")).toBe("plo4_hl");
    expect(normalizePokerVariant("7 card stud")).toBe("seven_card_stud");
  });
});
