import { describe, expect, it } from "vitest";
import { mttFieldCounts, mttRedrawBlocked } from "./mtt-field-display.js";
import type { SngSnapshot } from "./api.js";

const base: SngSnapshot = {
  status: "running",
  maxSeats: 8,
  buyInMojos: "1000000",
  prizePoolMojos: "16000000",
  handNumber: 500,
  smallBlindMojos: "10000",
  bigBlindMojos: "20000",
  playersRemaining: 8,
  humanCount: 1,
  houseSeatsAvailable: 0,
  placements: [],
  kind: "mtt",
  fieldSize: 16,
  eventPlayersRemaining: 500,
  otherTablePlayers: 492,
};

describe("mttFieldCounts", () => {
  it("ignores absurd eventPlayersRemaining from stale clients", () => {
    expect(mttFieldCounts(base)).toEqual({ inField: 16, atOtherTable: 8 });
  });
});

describe("mttRedrawBlocked", () => {
  it("treats redraw API errors as blocked even when pauseDeals is missing", () => {
    expect(mttRedrawBlocked({ ...base, pauseDeals: false }, "Waiting to redraw tables")).toBe(true);
  });
});
