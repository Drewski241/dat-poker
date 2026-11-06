import { describe, expect, it } from "vitest";
import {
  VAULT_PRIZE_MULTIPLIERS,
  buildVaultCards,
  flipVaultCard,
  vaultCollectedMultiplier,
} from "./vault-bonus.js";

describe("vault bonus", () => {
  it("deals four prizes and one rake", () => {
    const cards = buildVaultCards(() => 0);
    const prizes = cards.filter((card) => card.kind === "prize").map((card) => card.multiplier);
    expect(prizes.sort((a, b) => a - b)).toEqual([...VAULT_PRIZE_MULTIPLIERS]);
    expect(cards.filter((card) => card.kind === "rake")).toHaveLength(1);
  });

  it("keeps prizes flipped before the rake", () => {
    const cards = buildVaultCards(() => 0);
    const rakeAt = cards.findIndex((card) => card.kind === "rake");
    let revealed: number[] = [];
    let finished = false;
    for (let index = 0; index < cards.length; index += 1) {
      const flip = flipVaultCard(cards, revealed, index);
      revealed = flip.revealed;
      finished = flip.finished;
      if (finished) break;
    }
    expect(finished).toBe(true);
    expect(revealed).toEqual(Array.from({ length: rakeAt + 1 }, (_, i) => i));
    const expected = cards
      .slice(0, rakeAt)
      .reduce((sum, card) => sum + (card.kind === "prize" ? card.multiplier : 0), 0);
    expect(vaultCollectedMultiplier(cards, revealed)).toBe(expected);
  });

  it("refuses a second flip of the same chip", () => {
    const cards = buildVaultCards(() => 0);
    const first = flipVaultCard(cards, [], 0);
    expect(() => flipVaultCard(cards, first.revealed, 0)).toThrow(/already flipped/);
  });
});
