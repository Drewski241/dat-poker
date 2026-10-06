import { describe, expect, it } from "vitest";
import { betweenHandsStatusMessage, mttFieldLabel } from "./between-hands-status.js";

describe("betweenHandsStatusMessage", () => {
  const now = 1_000_000;

  it("shows registration countdown for MTT", () => {
    expect(
      betweenHandsStatusMessage({
        nowMs: now,
        tableFormat: "mtt",
        autoDeal: true,
        autoDealAtMs: now + 4_500,
        sng: { status: "registering" } as never,
        sittingOut: false,
        busy: false,
        canAutoDeal: false,
      }),
    ).toBe("Seating the field… tournament starts in 0:05");
  });

  it("shows redraw countdown when deals are paused", () => {
    expect(
      betweenHandsStatusMessage({
        nowMs: now,
        tableFormat: "mtt",
        autoDeal: true,
        autoDealAtMs: now + 2_000,
        sng: { status: "running", pauseDeals: true } as never,
        sittingOut: false,
        busy: false,
        canAutoDeal: false,
      }),
    ).toBe("Redrawing tables… next hand in 0:02");
  });

  it("shows next-hand countdown when auto-deal is armed", () => {
    expect(
      betweenHandsStatusMessage({
        nowMs: now,
        tableFormat: "cash",
        autoDeal: true,
        autoDealAtMs: now + 1_000,
        sng: null,
        sittingOut: false,
        busy: false,
        canAutoDeal: true,
      }),
    ).toBe("Next hand in 0:01");
  });
});

describe("mttFieldLabel", () => {
  it("uses fieldSize when present", () => {
    expect(mttFieldLabel({ fieldSize: 500, maxSeats: 8 } as never)).toBe("500-player MTT");
  });
});
