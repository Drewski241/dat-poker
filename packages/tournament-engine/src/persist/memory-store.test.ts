import { describe, expect, it } from "vitest";
import { MemoryTournamentStore } from "./memory-store.js";
import { TournamentEngine } from "../tournament.js";

describe("MemoryTournamentStore", () => {
  it("round-trips tournament state", async () => {
    const store = new MemoryTournamentStore();
    const t = new TournamentEngine({
      name: "Persist me",
      format: "sng",
      maxSeats: 6,
      maxEntries: 6,
      minEntries: 6,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
    });
    t.registerPlayers(["a", "b", "c", "d", "e", "f"]);
    t.start();
    await store.save(t.exportState());

    const loaded = await store.load(t.getId());
    expect(loaded).not.toBeNull();
    const restored = TournamentEngine.fromExportedState(loaded!);
    expect(restored.getStatus()).toBe(t.getStatus());
    expect(restored.getActiveCount()).toBe(6);
    expect(restored.getPrizePoolMojos()).toBe(t.getPrizePoolMojos());
  });
});
