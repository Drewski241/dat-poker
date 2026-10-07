import { describe, expect, it } from "vitest";
import { shouldAutoDealNextHand, sngShouldAutoDeal } from "./sng-auto-deal.js";

const sngReady = {
  atTableRoom: true,
  tableFormat: "sng",
  sngStatus: "running",
  seated: true,
  occupiedSeats: 9,
  handLive: false,
  busy: false,
  stackIsZero: false,
  runoutPlaying: false,
  eliminated: false,
};

const cashReady = {
  atTableRoom: true,
  tableFormat: "cash",
  sngStatus: null,
  seated: true,
  occupiedSeats: 2,
  handLive: false,
  busy: false,
  stackIsZero: false,
  runoutPlaying: false,
  eliminated: false,
};

describe("shouldAutoDealNextHand", () => {
  it("auto-deals cash when seated with chips and enough players", () => {
    expect(shouldAutoDealNextHand(cashReady)).toBe(true);
  });

  it("does not auto-deal cash while sitting out", () => {
    expect(shouldAutoDealNextHand({ ...cashReady, sittingOut: true })).toBe(false);
  });

  it("still auto-deals MTT while sitting out so the field keeps moving", () => {
    expect(shouldAutoDealNextHand({ ...sngReady, tableFormat: "mtt", sittingOut: true })).toBe(true);
  });

  it("does not auto-deal cash with fewer than two occupied seats", () => {
    expect(shouldAutoDealNextHand({ ...cashReady, occupiedSeats: 1 })).toBe(false);
  });

  it("deals when a seated human is at a running SNG between hands", () => {
    expect(shouldAutoDealNextHand(sngReady)).toBe(true);
    expect(sngShouldAutoDeal(sngReady)).toBe(true);
  });

  it("waits during a live hand, runout, or big-win celebration", () => {
    expect(shouldAutoDealNextHand({ ...cashReady, handLive: true })).toBe(false);
    expect(shouldAutoDealNextHand({ ...sngReady, runoutPlaying: true })).toBe(false);
    expect(shouldAutoDealNextHand({ ...sngReady, celebrationPlaying: true })).toBe(false);
  });

  it("does not deal from the lobby or after elimination", () => {
    expect(shouldAutoDealNextHand({ ...sngReady, atTableRoom: false })).toBe(false);
    expect(shouldAutoDealNextHand({ ...sngReady, eliminated: true })).toBe(false);
    expect(shouldAutoDealNextHand({ ...sngReady, sngStatus: "finished" })).toBe(false);
    expect(shouldAutoDealNextHand({ ...sngReady, tableFormat: "mtt" })).toBe(true);
    expect(shouldAutoDealNextHand({ ...sngReady, pauseDeals: true })).toBe(false);
  });
});
