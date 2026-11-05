import { describe, expect, it } from "vitest";
import type { TableConfig } from "@dat-poker/shared";
import { NlheTableEngine } from "./nlhe-table.js";
import { DrawTableEngine } from "./draw-table.js";
import { StudTableEngine } from "./stud-table.js";
import { createTableEngine } from "./table-engine.js";
import { generateServerSeed } from "./shuffle.js";

function cash(variant: TableConfig["variant"], maxSeats = 6): TableConfig {
  return {
    id: `${variant}-cash`,
    variant,
    format: "cash",
    maxSeats,
    smallBlindMojos: 50n,
    bigBlindMojos: 100n,
    minBuyInMojos: 1_000n,
    maxBuyInMojos: 10_000n,
    rakeBps: 0,
  };
}

function dealTwo(table: NlheTableEngine | DrawTableEngine | StudTableEngine): void {
  table.seatPlayer("alice", 0, 5_000n);
  table.seatPlayer("bob", 1, 5_000n);
  table.startHand("h1");
  table.submitPlayerSeed("alice", generateServerSeed());
  table.submitPlayerSeed("bob", generateServerSeed());
  table.revealAndDeal();
}

describe("createTableEngine routing", () => {
  it("routes draw and stud variants to specialized engines", () => {
    expect(createTableEngine(cash("five_card_draw"))).toBeInstanceOf(DrawTableEngine);
    expect(createTableEngine(cash("triple_draw_27"))).toBeInstanceOf(DrawTableEngine);
    expect(createTableEngine(cash("badugi"))).toBeInstanceOf(DrawTableEngine);
    expect(createTableEngine(cash("seven_card_stud"))).toBeInstanceOf(StudTableEngine);
    expect(createTableEngine(cash("razz"))).toBeInstanceOf(StudTableEngine);
    expect(createTableEngine(cash("pineapple"))).toBeInstanceOf(NlheTableEngine);
    expect(createTableEngine(cash("plo4_hl"))).toBeInstanceOf(NlheTableEngine);
  });
});

describe("Pineapple", () => {
  it("deals three hole cards and requires a preflop discard", () => {
    const table = new NlheTableEngine(cash("pineapple"));
    dealTwo(table);
    const state = table.getHandState()!;
    expect(state.street).toBe("discard");
    expect(state.players.every((p) => p.holeCards.length === 3)).toBe(true);
    expect(state.players.every((p) => p.needsDiscard)).toBe(true);

    const first = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyDiscard(first.playerId, [0]);
    const mid = table.getHandState()!;
    const second = mid.players.find((p) => p.seatIndex === mid.actionSeat)!;
    table.applyDiscard(second.playerId, [1]);
    const after = table.getHandState()!;
    expect(after.street).toBe("preflop");
    expect(after.players.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(after.potMojos).toBeGreaterThan(0n);
  });
});

describe("Five-card draw", () => {
  it("deals five cards, draws, and can finish on a fold", () => {
    const table = new DrawTableEngine(cash("five_card_draw"));
    dealTwo(table);
    const state = table.getHandState()!;
    expect(state.street).toBe("betting1");
    expect(state.players.every((p) => p.holeCards.length === 5)).toBe(true);

    const actor = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(actor.playerId, "fold");
    expect(table.getHandState()).toBeNull();
    expect(table.getLastHandResult()?.reason).toBe("fold");
  });

  it("stands pat through a draw round", () => {
    const table = new DrawTableEngine(cash("five_card_draw"));
    dealTwo(table);
    let state = table.getHandState()!;
    // SB completes / calls, BB checks → draw
    const first = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(first.playerId, "call");
    state = table.getHandState()!;
    if (state.street === "betting1") {
      const next = state.players.find((p) => p.seatIndex === state.actionSeat)!;
      table.applyAction(next.playerId, "check");
    }
    state = table.getHandState()!;
    expect(state.street).toBe("draw1");
    const drawer = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyDiscard(drawer.playerId, []);
    state = table.getHandState()!;
    const drawer2 = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyDiscard(drawer2.playerId, [0, 1]);
    state = table.getHandState()!;
    expect(state.street).toBe("betting2");
    expect(state.players.every((p) => p.holeCards.length === 5)).toBe(true);
  });
});

describe("2-7 triple draw", () => {
  it("runs three draw rounds", () => {
    const table = new DrawTableEngine(cash("triple_draw_27"));
    dealTwo(table);
    expect(table.getHandState()!.players.every((p) => p.holeCards.length === 5)).toBe(true);

    const finishBetting = () => {
      let guard = 0;
      while (table.getHandState() && !String(table.getHandState()!.street).startsWith("draw") && table.getHandState()!.street !== "showdown") {
        const h = table.getHandState()!;
        if (h.actionSeat == null) break;
        const actor = h.players.find((p) => p.seatIndex === h.actionSeat)!;
        const toCall = h.currentBetMojos - actor.betThisStreetMojos;
        table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
        guard += 1;
        if (guard > 8) break;
      }
    };
    const standPatRound = () => {
      let guard = 0;
      while (table.getHandState() && String(table.getHandState()!.street).startsWith("draw")) {
        const h = table.getHandState()!;
        const actor = h.players.find((p) => p.seatIndex === h.actionSeat)!;
        table.applyDiscard(actor.playerId, []);
        guard += 1;
        if (guard > 8) break;
      }
    };

    finishBetting();
    expect(table.getHandState()!.street).toBe("draw1");
    standPatRound();
    finishBetting();
    expect(table.getHandState()!.street).toBe("draw2");
    standPatRound();
    finishBetting();
    expect(table.getHandState()!.street).toBe("draw3");
    standPatRound();
    finishBetting();
    expect(table.getLastHandResult()?.reason).toBe("showdown");
  });
});

describe("Badugi", () => {
  it("deals four cards", () => {
    const table = new DrawTableEngine(cash("badugi"));
    dealTwo(table);
    expect(table.getHandState()!.players.every((p) => p.holeCards.length === 4)).toBe(true);
  });
});

describe("Seven-card stud", () => {
  it("deals three cards on third street (2 down + 1 up)", () => {
    const table = new StudTableEngine(cash("seven_card_stud"));
    dealTwo(table);
    const state = table.getHandState()!;
    expect(state.street).toBe("third");
    expect(state.players.every((p) => p.holeCards.length === 3)).toBe(true);
    expect(state.players.every((p) => p.upCardIndexes.length === 1)).toBe(true);
  });
});

describe("Razz", () => {
  it("uses stud engine and deals third street", () => {
    const table = new StudTableEngine(cash("razz"));
    dealTwo(table);
    expect(table.getHandState()!.street).toBe("third");
    expect(table.getConfig().variant).toBe("razz");
  });
});

describe("Omaha hi/lo", () => {
  it("deals four hole cards under pot-limit", () => {
    const table = new NlheTableEngine(cash("plo4_hl"));
    dealTwo(table);
    const state = table.getHandState()!;
    expect(state.players.every((p) => p.holeCards.length === 4)).toBe(true);
  });
});
