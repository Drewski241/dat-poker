import { describe, expect, it } from "vitest";
import {
  isChopFromParticipants,
  participantAwardMojos,
  totalPotFromParticipants,
} from "./hand-result-copy.js";

describe("hand-result-copy", () => {
  it("detects a HU chop where each player gets their contribution back", () => {
    const participants = [
      {
        playerId: "you",
        stackBeforePayoutMojos: "0",
        stackAfterMojos: "4920",
      },
      {
        playerId: "house",
        stackBeforePayoutMojos: "4160",
        stackAfterMojos: "9080",
      },
    ];
    expect(participantAwardMojos(participants[0]!)).toBe(4920n);
    expect(participantAwardMojos(participants[1]!)).toBe(4920n);
    expect(isChopFromParticipants(participants)).toBe(true);
    expect(totalPotFromParticipants(participants)).toBe(9840n);
  });

  it("is not a chop when only the winner is awarded chips", () => {
    const participants = [
      {
        playerId: "you",
        stackBeforePayoutMojos: "0",
        stackAfterMojos: "9840",
      },
      {
        playerId: "house",
        stackBeforePayoutMojos: "4160",
        stackAfterMojos: "4160",
      },
    ];
    expect(isChopFromParticipants(participants)).toBe(false);
    expect(totalPotFromParticipants(participants)).toBe(9840n);
  });
});
