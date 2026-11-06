import { describe, expect, it, beforeEach } from "vitest";
import {
  getDailyRitual,
  recordFreerollEntry,
  recordFreerollFinish,
  releaseFreerollEntry,
  resetRitualForTests,
} from "./ritual-store.js";

describe("ritual-store", () => {
  beforeEach(() => {
    process.env.DAT_RITUAL_PATH = "memory";
    resetRitualForTests();
  });

  it("allows one freeroll entry per UTC day and builds a streak", () => {
    const day1 = new Date("2026-10-11T15:00:00.000Z");
    expect(recordFreerollEntry("alice", day1)).toBe(true);
    expect(recordFreerollEntry("alice", day1)).toBe(false);
    let view = getDailyRitual("alice", day1);
    expect(view.freerollAvailable).toBe(false);
    expect(view.streakDays).toBe(1);
    expect(view.badge).toBe("Played today");

    const day2 = new Date("2026-10-12T08:00:00.000Z");
    expect(recordFreerollEntry("alice", day2)).toBe(true);
    view = getDailyRitual("alice", day2);
    expect(view.streakDays).toBe(2);

    const day4 = new Date("2026-10-14T08:00:00.000Z");
    expect(recordFreerollEntry("alice", day4)).toBe(true);
    view = getDailyRitual("alice", day4);
    expect(view.streakDays).toBe(1);
  });

  it("tracks ITM and wins for badges", () => {
    const now = new Date("2026-10-11T12:00:00.000Z");
    recordFreerollEntry("bob", now);
    recordFreerollFinish("bob", 1);
    const view = getDailyRitual("bob", now);
    expect(view.freerollWins).toBe(1);
    expect(view.freerollItm).toBe(1);
    expect(view.badge).toBe("Freeroll champ");
  });

  it("releases a same-day entry so a failed seat can retry", () => {
    const now = new Date("2026-10-11T12:00:00.000Z");
    expect(recordFreerollEntry("carol", now)).toBe(true);
    releaseFreerollEntry("carol", "2026-10-11");
    const view = getDailyRitual("carol", now);
    expect(view.freerollAvailable).toBe(true);
    expect(view.streakDays).toBe(0);
    expect(recordFreerollEntry("carol", now)).toBe(true);
  });
});
