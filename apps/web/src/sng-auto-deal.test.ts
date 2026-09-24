import { describe, expect, it } from "vitest";
import { sngShouldAutoDeal } from "./sng-auto-deal.js";

const ready = {
  atTableRoom: true,
  tableFormat: "sng",
  sngStatus: "running",
  seated: true,
  handLive: false,
  busy: false,
  stackIsZero: false,
  runoutPlaying: false,
  eliminated: false,
};

describe("sngShouldAutoDeal", () => {
  it("deals when a seated human is at a running SNG between hands", () => {
    expect(sngShouldAutoDeal(ready)).toBe(true);
  });

  it("waits during a live hand or runout", () => {
    expect(sngShouldAutoDeal({ ...ready, handLive: true })).toBe(false);
    expect(sngShouldAutoDeal({ ...ready, runoutPlaying: true })).toBe(false);
  });

  it("does not deal from the lobby or after elimination", () => {
    expect(sngShouldAutoDeal({ ...ready, atTableRoom: false })).toBe(false);
    expect(sngShouldAutoDeal({ ...ready, eliminated: true })).toBe(false);
    expect(sngShouldAutoDeal({ ...ready, sngStatus: "finished" })).toBe(false);
    expect(sngShouldAutoDeal({ ...ready, tableFormat: "cash" })).toBe(false);
  });
});
