import { describe, expect, it } from "vitest";
import { HandForHandController, shouldHandForHand } from "./hand-for-hand.js";

describe("hand-for-hand", () => {
  it("detects bubble and final table", () => {
    expect(
      shouldHandForHand({
        activeCount: 19,
        paidPlaces: 18,
        tableCount: 3,
        finalTableSeats: 8,
      }),
    ).toBe("bubble");
    expect(
      shouldHandForHand({
        activeCount: 8,
        paidPlaces: 18,
        tableCount: 2,
        finalTableSeats: 8,
      }),
    ).toBe("final_table");
    expect(
      shouldHandForHand({
        activeCount: 40,
        paidPlaces: 18,
        tableCount: 5,
        finalTableSeats: 8,
      }),
    ).toBeNull();
  });

  it("blocks deals until every table reports", () => {
    const c = new HandForHandController();
    c.enable(["t1", "t2"], "bubble");
    expect(c.canDeal("t1")).toBe(true);
    expect(c.reportHandComplete("t1").waveComplete).toBe(false);
    expect(c.canDeal("t1")).toBe(false);
    expect(c.canDeal("t2")).toBe(true);
    const done = c.reportHandComplete("t2");
    expect(done.waveComplete).toBe(true);
    expect(c.canDeal("t1")).toBe(true);
    expect(c.canDeal("t2")).toBe(true);
  });
});
