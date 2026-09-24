import { describe, expect, it } from "vitest";
import {
  formatHandCategory,
  runoutStreets,
  runoutVisibleCount,
  shouldPlayAllInRunout,
} from "./all-in-runout.js";

describe("all-in runout", () => {
  it("plays flop-turn-river when the board jumps from nothing to five", () => {
    expect(shouldPlayAllInRunout({ boardLen: 0, allIn: true }, { reason: "showdown", board: [1, 2, 3, 4, 5] })).toBe(
      true,
    );
    expect(runoutStreets(0)).toEqual(["flop", "turn", "river", "hands"]);
    expect(runoutVisibleCount("flop")).toBe(3);
    expect(runoutVisibleCount("turn")).toBe(4);
    expect(runoutVisibleCount("river")).toBe(5);
  });

  it("plays turn and river when the flop was already live", () => {
    expect(shouldPlayAllInRunout({ boardLen: 3, allIn: true }, { reason: "showdown", board: [1, 2, 3, 4, 5] })).toBe(
      true,
    );
    expect(runoutStreets(3)).toEqual(["turn", "river", "hands"]);
  });

  it("plays a slow river after an all-in on the turn", () => {
    expect(shouldPlayAllInRunout({ boardLen: 4, allIn: true }, { reason: "showdown", board: [1, 2, 3, 4, 5] })).toBe(
      true,
    );
    expect(runoutStreets(4)).toEqual(["river", "hands"]);
  });

  it("does not replay a river the player already saw", () => {
    expect(shouldPlayAllInRunout({ boardLen: 5, allIn: true }, { reason: "showdown", board: [1, 2, 3, 4, 5] })).toBe(
      false,
    );
    expect(shouldPlayAllInRunout({ boardLen: 4, allIn: false }, { reason: "showdown", board: [1, 2, 3, 4, 5] })).toBe(
      false,
    );
    expect(shouldPlayAllInRunout({ boardLen: 0, allIn: true }, { reason: "fold", board: [1, 2, 3, 4, 5] })).toBe(false);
  });

  it("formats hand categories for the showdown strip", () => {
    expect(formatHandCategory("full_house")).toBe("full house");
    expect(formatHandCategory("high_card")).toBe("high card");
  });
});
