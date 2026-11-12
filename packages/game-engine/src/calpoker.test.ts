import { describe, expect, it } from "vitest";
import { parseCard } from "./card.js";
import { applyCalpokerSwap, CalpokerTable, chooseCalpokerGiveaway } from "./calpoker.js";
import { evaluateBestHand } from "./hand-evaluator.js";

const cards = (...names: string[]) => names.map(parseCard);

function table(stack = 100_000n): CalpokerTable {
  return new CalpokerTable({
    id: "cp-1",
    playerId: "drew",
    displayName: "Drew",
    stackMojos: stack,
    minAnteMojos: 10_000n,
    maxAnteMojos: 50_000n,
  });
}

const shoe = cards(
  "Ah", "Kh", "Qh", "Jh", "Th", "2c", "3c", "4c",
  "9d", "8d", "7s", "6s", "5h", "4d", "3h", "2d",
  "As",
);

describe("applyCalpokerSwap", () => {
  it("trades the four chosen cards and keeps the other four", () => {
    const player = cards("Ah", "Kh", "Qh", "Jh", "Th", "2c", "3c", "4c");
    const house = cards("9d", "8d", "7s", "6s", "5h", "4d", "3h", "2d");
    const finals = applyCalpokerSwap(player, house, [4, 5, 6, 7], [0, 1, 2, 3]);
    expect(finals.playerFinal.map((card) => `${card.rank}${card.suit}`)).toEqual([
      "Ah", "Kh", "Qh", "Jh", "9d", "8d", "7s", "6s",
    ]);
    expect(finals.houseFinal.map((card) => `${card.rank}${card.suit}`)).toEqual([
      "5h", "4d", "3h", "2d", "Th", "2c", "3c", "4c",
    ]);
    expect(evaluateBestHand(finals.playerFinal).category).toBe("high_card");
  });
});

describe("CalpokerTable", () => {
  it("deals eight cards to each side and pays the better five-card hand", () => {
    const game = table();
    game.deal(10_000n, shoe);
    const dealt = game.view();
    expect(dealt.phase).toBe("selecting");
    expect(dealt.playerCards).toHaveLength(8);
    expect(dealt.houseCards).toHaveLength(8);
    expect(dealt.sessionResultMojos).toBe(0n);
    expect(dealt.serverSeed).toBeNull();
    expect(() => game.swap([0, 1, 2])).toThrow(/exactly four/i);

    game.swap([4, 5, 6, 7]);
    const done = game.view();
    expect(done.phase).toBe("done");
    expect(done.playerCards.filter((card) => card.played)).toHaveLength(5);
    expect(done.houseCards.filter((card) => card.played)).toHaveLength(5);
    const playerScore = evaluateBestHand(done.playerCards).score;
    const houseScore = evaluateBestHand(done.houseCards).score;
    if (playerScore > houseScore) {
      expect(done.winner).toBe("player");
      expect(done.stackMojos).toBe(110_000n);
    } else if (playerScore < houseScore) {
      expect(done.winner).toBe("house");
      expect(done.stackMojos).toBe(90_000n);
    } else {
      expect(done.winner).toBe("tie");
      expect(done.stackMojos).toBe(100_000n);
    }
    const used = new Set([...done.playerCards, ...done.houseCards].map((card) => `${card.rank}${card.suit}`));
    expect(used.size).toBe(16);
  });

  it("asks the house for four cards and continues a saved hand", () => {
    const game = table();
    game.deal(10_000n, shoe);
    const give = chooseCalpokerGiveaway(
      game.view().houseCards,
      game.view().playerCards,
    );
    expect(new Set(give).size).toBe(4);
    const restored = CalpokerTable.fromSnapshot(game.toSnapshot());
    restored.swap([0, 1, 2, 3]);
    expect(restored.view().phase).toBe("done");
    expect(restored.view().winner).not.toBeNull();
  });

  it("refuses an ante that would pass the session limit", () => {
    const game = table();
    game.setLossLimit(10_000n);
    expect(() => game.deal(20_000n, shoe)).toThrow(/pass your session limit/i);
    expect(game.view().stackMojos).toBe(100_000n);
    expect(game.view().phase).toBe("betting");
  });

  it("locks the deck until the swap", () => {
    const game = table();
    game.deal(10_000n);
    expect(game.view().commitHash).toMatch(/^[0-9a-f]{64}$/);
    expect(game.view().serverSeed).toBeNull();
    game.swap([0, 1, 2, 3]);
    expect(game.view().serverSeed).toMatch(/^[0-9a-f]{64}$/);
  });
});
