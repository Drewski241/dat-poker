import { describe, expect, it } from "vitest";
import {
  formatHandCategory,
  runoutAllInPlayerIds,
  runoutHoldMs,
  runoutStreets,
  runoutVisibleCount,
  shouldPlayAllInRunout,
} from "./all-in-runout.js";

describe("all-in runout", () => {
  it("plays flop-turn-river when the board jumps from nothing to five", () => {
    expect(
      shouldPlayAllInRunout(
        { boardLen: 0, allIn: true, viewerId: "you" },
        { reason: "showdown", board: [1, 2, 3, 4, 5], allInPlayerIds: ["you"] },
      ),
    ).toBe(true);
    expect(runoutStreets(0)).toEqual(["allin", "flop", "turn", "river", "hands"]);
    expect(runoutVisibleCount("allin", 0)).toBe(0);
    expect(runoutVisibleCount("flop")).toBe(3);
    expect(runoutVisibleCount("turn")).toBe(4);
    expect(runoutVisibleCount("river")).toBe(5);
  });

  it("plays turn and river when the flop was already live", () => {
    expect(
      shouldPlayAllInRunout(
        { boardLen: 3, allIn: true, viewerId: "you" },
        { reason: "showdown", board: [1, 2, 3, 4, 5], allInPlayerIds: ["you", "house"] },
      ),
    ).toBe(true);
    expect(runoutStreets(3)).toEqual(["allin", "turn", "river", "hands"]);
    expect(runoutVisibleCount("allin", 3)).toBe(3);
  });

  it("plays a slow river after an all-in on the turn", () => {
    expect(
      shouldPlayAllInRunout(
        { boardLen: 4, allIn: true, viewerId: "you" },
        { reason: "showdown", board: [1, 2, 3, 4, 5], allInPlayerIds: ["you"] },
      ),
    ).toBe(true);
    expect(runoutStreets(4)).toEqual(["allin", "river", "hands"]);
  });

  it("still slows down a river all-in so a losing player can look at the hands", () => {
    expect(
      shouldPlayAllInRunout(
        { boardLen: 5, allIn: true, viewerId: "you" },
        { reason: "showdown", board: [1, 2, 3, 4, 5], allInPlayerIds: ["you"] },
      ),
    ).toBe(true);
    expect(runoutStreets(5)).toEqual(["allin", "hands"]);
    expect(runoutHoldMs("hands", true)).toBeGreaterThan(runoutHoldMs("hands", false));
    expect(runoutHoldMs("flop")).toBeGreaterThanOrEqual(2000);
  });

  it("does not replay a check-down the player already saw", () => {
    expect(
      shouldPlayAllInRunout(
        { boardLen: 5, allIn: false },
        { reason: "showdown", board: [1, 2, 3, 4, 5] },
      ),
    ).toBe(false);
    expect(
      shouldPlayAllInRunout(
        { boardLen: 4, allIn: false },
        { reason: "showdown", board: [1, 2, 3, 4, 5] },
      ),
    ).toBe(false);
    expect(
      shouldPlayAllInRunout(
        { boardLen: 0, allIn: true },
        { reason: "fold", board: [1, 2, 3, 4, 5] },
      ),
    ).toBe(false);
  });

  it("does not treat a fold as an all-in just because the board ran out", () => {
    expect(
      shouldPlayAllInRunout(
        { boardLen: 0, allIn: false, viewerFolded: true, viewerId: "you" },
        { reason: "showdown", board: [1, 2, 3, 4, 5], shown: [{ playerId: "house", allIn: false }] },
      ),
    ).toBe(false);
  });

  it("plays for remaining all-in players after the viewer folds", () => {
    const live = { boardLen: 0, allIn: false, viewerFolded: true, viewerId: "you" };
    const result = {
      reason: "showdown",
      board: [1, 2, 3, 4, 5],
      allInPlayerIds: ["house-2", "house-5"],
    };
    expect(shouldPlayAllInRunout(live, result)).toBe(true);
    expect(runoutAllInPlayerIds(live, result)).toEqual(["house-2", "house-5"]);
    expect(runoutAllInPlayerIds(live, result).includes("you")).toBe(false);
  });

  it("formats hand categories for the showdown strip", () => {
    expect(formatHandCategory("full_house")).toBe("full house");
    expect(formatHandCategory("high_card")).toBe("high card");
  });
});
