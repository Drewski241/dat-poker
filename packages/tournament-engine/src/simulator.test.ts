import { describe, expect, it } from "vitest";
import { simulateTournament } from "./simulator.js";
import { TournamentEngine } from "./tournament.js";

describe("simulateTournament (bot field)", () => {
  it("runs an 8-max SNG to a winner with prizes", async () => {
    const result = await simulateTournament({
      players: 8,
      seed: 42,
      style: "passive",
      maxHands: 2_000,
      create: {
        format: "sng",
        maxSeats: 8,
        lateRegThroughLevel: -1,
        reentryAllowed: false,
        feeBps: 500,
        buyInMojos: 10_000n,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.winnerId).toBeTruthy();
    expect(result.handsPlayed).toBeGreaterThan(0);
    expect(result.prizePoolMojos).toBe(76_000n); // 8 * 9500
    expect(result.payouts.length).toBeGreaterThanOrEqual(1);
    const paid = result.payouts.reduce((a, p) => a + p.prizeMojos, 0n);
    expect(paid).toBe(result.prizePoolMojos);
  }, 30_000);

  it("runs a compact 16-player MTT to completion", async () => {
    const result = await simulateTournament({
      players: 16,
      seed: 7,
      style: "passive",
      maxHands: 8_000,
      create: {
        format: "mtt",
        maxSeats: 8,
        lateRegThroughLevel: -1,
        reentryAllowed: false,
        feeBps: 0,
        buyInMojos: 1_000n,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.winnerId).toMatch(/^bot-/);
    expect(result.prizePoolMojos).toBe(16_000n);
  }, 60_000);
});

describe("late reg + re-entry", () => {
  it("seats a late registrant and allows one re-entry", () => {
    const t = new TournamentEngine({
      name: "Late",
      format: "mtt",
      maxSeats: 8,
      maxEntries: 20,
      minEntries: 8,
      lateRegThroughLevel: 5,
      reentryAllowed: true,
      maxReentries: 1,
      feeBps: 0,
      buyInMojos: 1_000n,
    });
    t.registerPlayers(Array.from({ length: 8 }, (_, i) => `p${i}`));
    t.start();
    expect(t.isLateRegOpen()).toBe(true);

    const late = t.registerPlayer("late-1");
    expect(late.seated).toBe(true);
    expect(t.getActiveCount()).toBe(9);
    expect(t.getPrizePoolMojos()).toBe(9_000n);

    const bust = t.eliminatePlayer("p0");
    expect(bust.canReenter).toBe(true);
    expect(bust.finishPosition).toBeNull();

    const back = t.reenter("p0");
    expect(back.seated).toBe(true);
    expect(t.getActiveCount()).toBe(9);
    expect(t.getTotalEntriesPaid()).toBe(10);
  });
});
