import { describe, expect, it, beforeEach } from "vitest";
import type { TableConfig } from "@dat-poker/shared";
import { NlheTableEngine, parseCard, generateServerSeed } from "@dat-poker/game-engine";
import {
  getHandHistory,
  recordHandHistoryIfNew,
  resetHandHistoryForTests,
} from "./hand-history-store.js";

const config: TableConfig = {
  id: "hist-store",
  variant: "nlhe",
  format: "cash",
  maxSeats: 6,
  smallBlindMojos: 20n,
  bigBlindMojos: 40n,
  minBuyInMojos: 1_000n,
  maxBuyInMojos: 50_000n,
  rakeBps: 0,
};

describe("hand-history-store stackAfter timing", () => {
  beforeEach(() => {
    resetHandHistoryForTests();
  });

  it("records stackAfter after pot awards are applied (not stackBeforePayout)", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("you", 0, 4_920n);
    table.seatPlayer("house", 1, 9_080n);
    table.startHand("8c149471");
    table.submitPlayerSeed("you", generateServerSeed());
    table.submitPlayerSeed("house", generateServerSeed());
    table.revealAndDeal();

    const dealt = (
      table as unknown as {
        hand: {
          players: { playerId: string; holeCards: ReturnType<typeof parseCard>[] }[];
          deck: ReturnType<typeof parseCard>[];
          deckIndex: number;
        } | null;
      }
    ).hand!;
    for (const p of dealt.players) {
      if (p.playerId === "you") p.holeCards = [parseCard("9c"), parseCard("Ad")];
      else p.holeCards = [parseCard("3d"), parseCard("Ks")];
    }
    dealt.deck = ["Jh", "3c", "7c", "9h", "Td"].map(parseCard);
    dealt.deckIndex = 0;

    for (let guard = 0; guard < 8; guard++) {
      const state = table.getHandState();
      if (!state || state.actionSeat == null) break;
      const actor = state.players.find((p) => p.seatIndex === state.actionSeat && !p.folded);
      if (!actor || actor.allIn) break;
      table.applyAction(actor.playerId, "all-in");
    }
    table.advanceHandIfIdle();
    expect(table.isHandInProgress()).toBe(false);

    const result = table.getLastHandResult()!;
    const youBefore = result.participants.find((p) => p.playerId === "you")!.stackBeforePayoutMojos;
    expect(youBefore).toBe(0n);

    recordHandHistoryIfNew("table-hist", table);
    const [entry] = getHandHistory("table-hist");
    expect(entry).toBeDefined();
    const you = entry!.participants.find((p) => p.playerId === "you")!;
    const house = entry!.participants.find((p) => p.playerId === "house")!;

    // If stackAfter were snapshotted before award, winner would show 0 — the bug hypothesis.
    expect(you.stackAfterMojos).toBe("9840");
    expect(you.stackBeforePayoutMojos).toBe("0");
    expect(house.stackAfterMojos).toBe("4160");
    expect(house.stackBeforePayoutMojos).toBe("4160");
    expect(BigInt(you.stackAfterMojos)).toBe(youBefore + result.potMojos);
  });
});
