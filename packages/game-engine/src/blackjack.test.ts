import { describe, expect, it } from "vitest";
import { BlackjackTable, describeHand, handTotal } from "./blackjack.js";
import { parseCard } from "./card.js";

const cards = (...names: string[]) => names.map(parseCard);

function table(): BlackjackTable {
  return new BlackjackTable({
    id: "bj-1",
    playerId: "drew",
    displayName: "Drew",
    stackMojos: 100_000n,
    minBetMojos: 10_000n,
    maxBetMojos: 50_000n,
  });
}

describe("blackjack hands", () => {
  it("counts aces as eleven until the hand would bust", () => {
    expect(handTotal(cards("Ah", "Kd"))).toEqual({ total: 21, soft: true });
    expect(describeHand(cards("Ah", "Kd"))).toBe("Blackjack");
    expect(handTotal(cards("Ah", "9d", "As")).total).toBe(21);
    expect(handTotal(cards("Kh", "Qd", "2c")).total).toBe(22);
    expect(describeHand(cards("Ah", "6d"))).toBe("soft 17");
  });
});

describe("BlackjackTable", () => {
  it("pays a natural three to two and leaves the dealer standing", () => {
    const game = table();
    game.placeBet(10_000n, cards("Ah", "9c", "Kd", "7d", "5s"));
    const view = game.view();
    expect(view.phase).toBe("done");
    expect(view.hands[0].outcome).toBe("blackjack");
    expect(view.hands[0].profitMojos).toBe(15_000n);
    expect(view.stackMojos).toBe(115_000n);
    expect(view.dealerCards).toHaveLength(2);
    expect(view.serverSeed).toBeNull();
  });

  it("stands the dealer on soft seventeen", () => {
    const game = table();
    game.placeBet(10_000n, cards("Th", "Ah", "9d", "6c", "Ks"));
    game.stand();
    const view = game.view();
    expect(view.dealerCards.map((card) => card.rank).join("")).toBe("A6");
    expect(view.dealerTotal).toBe("soft 17");
    expect(view.hands[0].outcome).toBe("win");
    expect(view.stackMojos).toBe(110_000n);
  });

  it("takes the bet when the player busts", () => {
    const game = table();
    game.placeBet(10_000n, cards("Th", "9c", "6d", "7s", "Kh"));
    game.hit();
    const view = game.view();
    expect(view.hands[0].outcome).toBe("bust");
    expect(view.hands[0].profitMojos).toBe(-10_000n);
    expect(view.stackMojos).toBe(90_000n);
    expect(view.dealerCards).toHaveLength(2);
  });

  it("doubles the bet and takes one card", () => {
    const game = table();
    game.placeBet(10_000n, cards("5h", "Tc", "6d", "6s", "Qh", "2c"));
    game.double();
    const view = game.view();
    expect(view.hands[0].cards).toHaveLength(3);
    expect(view.hands[0].betMojos).toBe(20_000n);
    expect(view.hands[0].outcome).toBe("win");
    expect(view.stackMojos).toBe(120_000n);
  });

  it("splits a pair and pays twenty-one as an even win", () => {
    const game = table();
    game.placeBet(10_000n, cards("Ah", "9c", "Ad", "5d", "Kd", "9h", "2c", "3d"));
    game.split();
    const view = game.view();
    expect(view.phase).toBe("done");
    expect(view.hands).toHaveLength(2);
    expect(view.hands[0].total).toBe("21");
    expect(view.hands[0].outcome).toBe("win");
    expect(view.hands[0].profitMojos).toBe(10_000n);
    expect(view.hands[1].outcome).toBe("win");
    expect(view.stackMojos).toBe(120_000n);
  });

  it("refuses a raise bigger than the stack and continues a saved hand", () => {
    const game = table();
    expect(() => game.placeBet(200_000n, cards("9h", "8d", "2c", "3d"))).toThrow(/stack/i);
    game.placeBet(10_000n, cards("9h", "2c", "5d", "3d", "4s"));
    const restored = BlackjackTable.fromSnapshot(game.toSnapshot());
    restored.hit();
    expect(restored.view().hands[0].cards.map((card) => card.rank).join("")).toBe("954");
    expect(restored.view().phase).toBe("acting");
  });
});
