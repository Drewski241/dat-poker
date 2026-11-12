import { describe, expect, it } from "vitest";
import { parseCard } from "./card.js";
import { VideoPokerTable, classifyVideoPoker, videoPokerReturn } from "./video-poker.js";

const cards = (...names: string[]) => names.map(parseCard);

function table(stack = 100_000n): VideoPokerTable {
  return new VideoPokerTable({
    id: "vp-1",
    playerId: "drew",
    displayName: "Drew",
    stackMojos: stack,
    coinMojos: 10_000n,
  });
}

describe("classifyVideoPoker", () => {
  it("pays jacks or better and treats a lower pair as a loss", () => {
    expect(classifyVideoPoker(cards("Jh", "Jd", "2c", "3d", "4s"))).toBe("jacks_or_better");
    expect(classifyVideoPoker(cards("Th", "Td", "2c", "3d", "4s"))).toBe("nothing");
    expect(classifyVideoPoker(cards("Ah", "Kh", "Qh", "Jh", "Th"))).toBe("royal_flush");
    expect(classifyVideoPoker(cards("Ah", "2h", "3h", "4h", "5h"))).toBe("straight_flush");
  });

  it("returns the stake on jacks and 800 per coin on a five-coin royal", () => {
    expect(videoPokerReturn("jacks_or_better", 10_000n, 1, 5)).toBe(10_000n);
    expect(videoPokerReturn("royal_flush", 10_000n, 1, 5)).toBe(2_500_000n);
    expect(videoPokerReturn("royal_flush", 50_000n, 5, 5)).toBe(40_000_000n);
    expect(videoPokerReturn("nothing", 10_000n, 1, 5)).toBe(0n);
  });
});

describe("VideoPokerTable", () => {
  it("keeps held cards and pays a pair of jacks", () => {
    const game = table();
    game.deal(1, cards("Jh", "Jd", "2c", "3d", "4s", "9c", "8d", "7h"));
    game.toggleHold(0);
    game.toggleHold(1);
    game.draw();
    const view = game.view();
    expect(view.cards.map((card) => `${card.rank}${card.suit}`)).toEqual(["Jh", "Jd", "9c", "8d", "7h"]);
    expect(view.result).toBe("jacks_or_better");
    expect(view.profitMojos).toBe(0n);
    expect(view.stackMojos).toBe(100_000n);
    expect(view.phase).toBe("done");
  });

  it("builds a royal from the draw when only the ace is held", () => {
    const game = table(1_000_000n);
    game.deal(5, cards("Ah", "2c", "3d", "4s", "5h", "Kh", "Qh", "Jh", "Th"));
    game.toggleHold(0);
    game.draw();
    const view = game.view();
    expect(view.result).toBe("royal_flush");
    expect(view.payoutMojos).toBe(40_000_000n);
    expect(view.stackMojos).toBe(1_000_000n - 50_000n + 40_000_000n);
  });

  it("pays a one-coin royal at 250 and refuses a second deal mid-hand", () => {
    const game = table(1_000_000n);
    game.deal(1, cards("Ah", "Kh", "Qh", "Jh", "Th", "2c"));
    for (let i = 0; i < 5; i++) game.toggleHold(i);
    expect(() => game.deal(1)).toThrow(/in progress/i);
    game.draw();
    expect(game.view().payoutMojos).toBe(2_500_000n);
    expect(game.view().serverSeed).toBeNull();
  });

  it("locks the deck before the hold and reveals the seed after the draw", () => {
    const game = table();
    game.deal(1);
    const dealt = game.view();
    expect(dealt.phase).toBe("holding");
    expect(dealt.commitHash).toMatch(/^[0-9a-f]{64}$/);
    expect(dealt.serverSeed).toBeNull();
    expect(dealt.cards).toHaveLength(5);
    game.draw();
    const done = game.view();
    expect(done.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(done.cards).toHaveLength(5);
  });

  it("reloads a held hand and still draws from the same deck", () => {
    const game = table();
    game.deal(1, cards("Ah", "2c", "3d", "4s", "5h", "Kh", "Qh", "Jh", "Th"));
    game.toggleHold(0);
    const restored = VideoPokerTable.fromSnapshot(game.toSnapshot());
    restored.draw();
    expect(restored.view().result).toBe("royal_flush");
  });

  it("rejects a bet bigger than the stack", () => {
    const game = table(20_000n);
    expect(() => game.deal(5)).toThrow(/bigger than your stack/i);
    expect(game.view().phase).toBe("betting");
    expect(game.view().stackMojos).toBe(20_000n);
  });
});
