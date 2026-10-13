import { describe, expect, it, beforeEach } from "vitest";
import {
  getOpsMetricsSnapshot,
  recordActivePlayer,
  recordHandCompleted,
  resetOpsMetricsForTests,
  streetFromHand,
  utcDayKey,
} from "./ops-metrics.js";

describe("ops-metrics", () => {
  beforeEach(() => {
    resetOpsMetricsForTests();
  });

  it("maps fold board length to drop-off street", () => {
    expect(streetFromHand("fold", 0)).toBe("preflop");
    expect(streetFromHand("fold", 3)).toBe("flop");
    expect(streetFromHand("fold", 4)).toBe("turn");
    expect(streetFromHand("fold", 5)).toBe("river");
    expect(streetFromHand("showdown", 5)).toBe("showdown");
  });

  it("counts anonymized DAU, hands, and hands/session", () => {
    const now = Date.parse(`${utcDayKey()}T12:00:00.000Z`);
    recordActivePlayer("alice", now);
    recordActivePlayer("alice", now + 1);
    recordActivePlayer("bob", now);
    recordActivePlayer("dat-poker:house", now);
    recordHandCompleted({
      reason: "fold",
      boardLen: 0,
      participantIds: ["alice", "dat-poker:house"],
      nowMs: now,
    });
    recordHandCompleted({
      reason: "showdown",
      boardLen: 5,
      participantIds: ["alice", "bob"],
      nowMs: now + 2,
    });

    const snap = getOpsMetricsSnapshot(now);
    expect(snap.dau).toBe(2);
    expect(snap.handsCompleted).toBe(2);
    expect(snap.handsPerActivePlayer).toBe(1);
    expect(snap.dropOffStreet.preflop).toBe(1);
    expect(snap.dropOffStreet.showdown).toBe(1);
    expect(snap.recentDays[0]?.day).toBe(snap.day);
  });
});
