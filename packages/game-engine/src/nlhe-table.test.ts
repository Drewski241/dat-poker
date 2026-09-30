import { describe, expect, it } from "vitest";
import type { TableConfig } from "@dat-poker/shared";
import { parseCard } from "./card.js";
import { NlheTableEngine } from "./nlhe-table.js";
import { generateServerSeed } from "./shuffle.js";

const config: TableConfig = {
  id: "table-1",
  variant: "nlhe",
  format: "cash",
  maxSeats: 6,
  smallBlindMojos: 50_000_000_000n,
  bigBlindMojos: 100_000_000_000n,
  minBuyInMojos: 2_000_000_000_000n,
  maxBuyInMojos: 20_000_000_000_000n,
  rakeBps: 500,
};

describe("NlheTableEngine", () => {
  it("runs commit-reveal deal and heads-up fold", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    const { commitHash } = table.startHand("hand-1");
    expect(commitHash).toHaveLength(64);

    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const state = table.getHandState();
    expect(state?.players.every((p) => p.holeCards.length === 2)).toBe(true);

    table.applyAction("alice", "fold");
    expect(table.getHandState()).toBeNull();
    expect(table.getLastHandResult()?.winnerId).toBe("bob");
    expect(table.getLastHandResult()?.reason).toBe("fold");
    expect(table.getLastHandResult()?.shown).toEqual([]);
    expect(table.getHandsPlayed("alice")).toBe(1);
    expect(table.getHandsPlayed("bob")).toBe(1);
  });

  it("enforces min raise equal to the last bet increment", () => {
    const small: TableConfig = {
      ...config,
      smallBlindMojos: 50_000n,
      bigBlindMojos: 100_000n,
      minBuyInMojos: 5_000_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(small);
    table.seatPlayer("alice", 0, 10_000_000n);
    table.seatPlayer("bob", 1, 10_000_000n);
    table.startHand("hand-min-raise");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const actor = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(actor.playerId, "call");
    state = table.getHandState()!;
    const bb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(bb.playerId, "check");

    state = table.getHandState()!;
    expect(state.street).toBe("flop");
    const flopActor = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    const betTo = 300_000n;
    table.applyAction(flopActor.playerId, "bet", betTo);

    state = table.getHandState()!;
    expect(state.currentBetMojos).toBe(betTo);
    expect(state.lastRaiseIncrementMojos).toBe(betTo);

    const raiser = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    expect(() => table.applyAction(raiser.playerId, "raise", 500_000n)).toThrow(/last bet or raise/i);
    table.applyAction(raiser.playerId, "raise", 600_000n);
    expect(table.getHandState()?.currentBetMojos).toBe(600_000n);
  });

  it("runs out board to showdown when both players are all-in preflop", () => {
    const small: TableConfig = {
      ...config,
      smallBlindMojos: 50_000n,
      bigBlindMojos: 100_000n,
      minBuyInMojos: 5_000_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(small);
    table.seatPlayer("alice", 0, 10_000_000n);
    table.seatPlayer("bob", 1, 10_000_000n);
    table.startHand("hand-ai-runout");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const sb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(sb.playerId, "raise", 500_000n);
    state = table.getHandState()!;
    const bb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(bb.playerId, "raise", 1_500_000n);
    state = table.getHandState()!;
    const sb2 = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(sb2.playerId, "all-in");
    state = table.getHandState()!;
    const bb2 = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(bb2.playerId, "call");

    expect(table.getHandState()).toBeNull();
    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.board).toHaveLength(5);
  });

  it("marks a tied showdown as a chop and pays each player their share", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 50n,
      bigBlindMojos: 100n,
      minBuyInMojos: 1_000n,
      maxBuyInMojos: 50_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 5_000n);
    table.seatPlayer("bob", 1, 5_000n);
    table.startHand("hand-chop");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
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
    // Same made hand at showdown (trip deuces, Ace kicker) → chop.
    for (const p of dealt.players) {
      if (p.playerId === "alice") p.holeCards = [parseCard("Ah"), parseCard("Kd")];
      else p.holeCards = [parseCard("Ac"), parseCard("Ks")];
    }
    dealt.deck = ["2h", "2d", "2c", "7s", "8h"].map(parseCard);
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

    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.isChop).toBe(true);
    expect(result?.totalPotMojos).toBe(10_000n);
    expect(result?.potMojos).toBe(5_000n);
    expect(table.getPlayerStack("alice")).toBe(5_000n);
    expect(table.getPlayerStack("bob")).toBe(5_000n);
  });

  it("caps showdown winnings at the short stack (main and side pots)", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 1n,
      bigBlindMojos: 2n,
      minBuyInMojos: 500n,
      maxBuyInMojos: 50_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("short", 0, 1000n);
    table.seatPlayer("deep", 1, 2000n);
    table.startHand("hand-side-pot");
    table.submitPlayerSeed("short", generateServerSeed());
    table.submitPlayerSeed("deep", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const sb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(sb.playerId, "all-in");
    state = table.getHandState()!;
    const bb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(bb.playerId, "all-in");

    expect(table.getHandState()).toBeNull();
    const shortStack = table.getPlayerStack("short")!;
    const deepStack = table.getPlayerStack("deep")!;
    expect(shortStack + deepStack).toBe(3000n);

    const result = table.getLastHandResult()!;
    // Headline pot is the matched/contested amount (uncalled chips are refunded).
    expect(result.potMojos).toBe(2000n);
    if (result.winnerId === "short") {
      expect(shortStack).toBe(2000n);
      expect(deepStack).toBe(1000n);
    } else {
      expect(deepStack).toBe(3000n);
      expect(shortStack).toBe(0n);
    }
  });

  it("refunds uncalled chips when a deep shove meets a short house stack", () => {
    const shortCfg: TableConfig = {
      ...config,
      smallBlindMojos: 5_000n,
      bigBlindMojos: 10_000n,
      minBuyInMojos: 50_000n,
      maxBuyInMojos: 5_000_000n,
    };
    const table = new NlheTableEngine(shortCfg);
    const humanStack = 1_000_000n;
    const houseStack = 100_000n;
    table.seatPlayer("alice", 0, humanStack);
    table.seatPlayer("dat-poker:house", 1, houseStack);

    table.startHand("hand-short-cover");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("dat-poker:house", generateServerSeed());
    table.revealAndDeal();

    const hand = table.getHandState()!;
    const firstActor = hand.players.find((p) => p.seatIndex === hand.actionSeat)!;
    if (firstActor.playerId === "alice") {
      table.applyAction("alice", "all-in");
      table.applyAction("dat-poker:house", "call");
    } else {
      table.applyAction("dat-poker:house", "check");
      table.applyAction("alice", "all-in");
      table.applyAction("dat-poker:house", "call");
    }

    expect(table.getHandState()).toBeNull();
    const aliceFinal = table.getPlayerStack("alice") ?? 0n;
    const houseFinal = table.getPlayerStack("dat-poker:house") ?? 0n;
    expect(aliceFinal + houseFinal).toBe(humanStack + houseStack);
    expect(aliceFinal).toBeGreaterThanOrEqual(humanStack - houseStack);
    expect(aliceFinal).toBeLessThanOrEqual(humanStack + houseStack);
  });

  it("deep shove covering several shorter stacks busts them all when it wins", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 50n,
      bigBlindMojos: 100n,
      minBuyInMojos: 1_000n,
      maxBuyInMojos: 5_000_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("human", 0, 1_000_000n);
    table.seatPlayer("house-a", 1, 50_000n);
    table.seatPlayer("house-b", 2, 100_000n);
    table.seatPlayer("house-c", 3, 200_000n);

    table.startHand("hand-cover-all");
    for (const id of ["human", "house-a", "house-b", "house-c"]) {
      table.submitPlayerSeed(id, generateServerSeed());
    }
    table.revealAndDeal();

    // Force a human win via internal hand state (getHandState clones).
    const dealt = (table as unknown as { hand: {
      players: { playerId: string; holeCards: ReturnType<typeof parseCard>[] }[];
      deck: ReturnType<typeof parseCard>[];
      deckIndex: number;
    } | null }).hand!;
    for (const p of dealt.players) {
      if (p.playerId === "human") {
        p.holeCards = [parseCard("Ah"), parseCard("Ad")];
      } else if (p.playerId === "house-a") {
        p.holeCards = [parseCard("2c"), parseCard("3d")];
      } else if (p.playerId === "house-b") {
        p.holeCards = [parseCard("4c"), parseCard("5d")];
      } else {
        p.holeCards = [parseCard("6c"), parseCard("7d")];
      }
    }
    dealt.deck = ["Kc", "Qc", "Jc", "9s", "8h"].map(parseCard);
    dealt.deckIndex = 0;

    for (let guard = 0; guard < 16; guard++) {
      const state = table.getHandState();
      if (!state || state.street !== "preflop" || state.actionSeat == null) break;
      const actor = state.players.find((p) => p.seatIndex === state.actionSeat && !p.folded);
      if (!actor || actor.allIn) break;
      table.applyAction(actor.playerId, "all-in");
    }
    table.advanceHandIfIdle();
    expect(table.isHandInProgress()).toBe(false);

    expect(table.getLastHandResult()?.winnerId).toBe("human");
    expect(table.getPlayerStack("house-a")).toBe(0n);
    expect(table.getPlayerStack("house-b")).toBe(0n);
    expect(table.getPlayerStack("house-c")).toBe(0n);
    expect(table.getPlayerStack("human")).toBe(1_350_000n);
  });

  it("keeps multiway side-pot layers when reconciling an uncalled deep shove", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 1n,
      bigBlindMojos: 2n,
      minBuyInMojos: 100n,
      maxBuyInMojos: 50_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("deep", 0, 10_000n);
    table.seatPlayer("mid", 1, 3_000n);
    table.seatPlayer("short", 2, 1_000n);
    table.startHand("hand-layers");
    for (const id of ["deep", "mid", "short"]) {
      table.submitPlayerSeed(id, generateServerSeed());
    }
    table.revealAndDeal();

    const dealt = (table as unknown as { hand: {
      players: { playerId: string; holeCards: ReturnType<typeof parseCard>[] }[];
      deck: ReturnType<typeof parseCard>[];
      deckIndex: number;
    } | null }).hand!;
    for (const p of dealt.players) {
      if (p.playerId === "deep") p.holeCards = [parseCard("Ah"), parseCard("Ad")];
      else if (p.playerId === "mid") p.holeCards = [parseCard("2c"), parseCard("3d")];
      else p.holeCards = [parseCard("4c"), parseCard("5d")];
    }
    dealt.deck = ["Kc", "Qc", "Jc", "9s", "8h"].map(parseCard);
    dealt.deckIndex = 0;

    for (let guard = 0; guard < 12; guard++) {
      const state = table.getHandState();
      if (!state || state.actionSeat == null) break;
      const actor = state.players.find((p) => p.seatIndex === state.actionSeat && !p.folded);
      if (!actor || actor.allIn) break;
      table.applyAction(actor.playerId, "all-in");
    }
    table.advanceHandIfIdle();
    expect(table.isHandInProgress()).toBe(false);

    expect(table.getLastHandResult()?.winnerId).toBe("deep");
    expect(table.getPlayerStack("short")).toBe(0n);
    expect(table.getPlayerStack("mid")).toBe(0n);
    // Deep risked only up to mid (3k); uncalled 7k returned + won both pots.
    expect(table.getPlayerStack("deep")).toBe(14_000n);
  });

  it("deals a short-for-blind stack all-in and settles a side pot", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 5_000n,
      bigBlindMojos: 10_000n,
      minBuyInMojos: 1_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("short", 0, 3_000n);
    table.seatPlayer("deep", 1, 100_000n);
    table.startHand("hand-short-blind");
    table.submitPlayerSeed("short", generateServerSeed());
    table.submitPlayerSeed("deep", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const short = state.players.find((p) => p.playerId === "short")!;
    expect(short.allIn).toBe(true);
    expect(short.totalBetHandMojos).toBe(3_000n);
    expect(short.stackMojos).toBe(0n);

    // BB still has the option to act when the SB is already short all-in.
    table.advanceHandIfIdle();
    state = table.getHandState()!;
    expect(state).not.toBeNull();
    const actor = state.players.find((p) => p.seatIndex === state.actionSeat && !p.folded)!;
    expect(actor.playerId).toBe("deep");
    table.applyAction("deep", "check");
    table.advanceHandIfIdle();

    expect(table.isHandInProgress()).toBe(false);
    const shortFinal = table.getPlayerStack("short")!;
    const deepFinal = table.getPlayerStack("deep")!;
    expect(shortFinal + deepFinal).toBe(103_000n);
    expect(shortFinal === 0n || shortFinal === 6_000n).toBe(true);
  });

  it("skips zero-stack seats on the next deal without confiscating leftover chips", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 50n,
      bigBlindMojos: 100n,
      minBuyInMojos: 100n,
      maxBuyInMojos: 50_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 5_000n);
    table.seatPlayer("bob", 1, 5_000n);
    table.seatPlayer("broke", 2, 100n);
    const internal = table as unknown as { stacks: Map<string, bigint> };
    internal.stacks.set("broke", 0n);

    table.startHand("hand-skip-broke");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    expect(() => table.submitPlayerSeed("broke", generateServerSeed())).toThrow(/not in hand/i);
    table.revealAndDeal();
    const hand = table.getHandState()!;
    expect(hand.players.map((p) => p.playerId).sort()).toEqual(["alice", "bob"]);
    expect(table.hasPlayer("broke")).toBe(true);
    expect(table.getPlayerStack("broke")).toBe(0n);
  });

  it("marks a player all-in when a raise consumes their entire stack", () => {
    const small: TableConfig = {
      ...config,
      smallBlindMojos: 50_000n,
      bigBlindMojos: 100_000n,
      minBuyInMojos: 5_000_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(small);
    table.seatPlayer("alice", 0, 5_000_000n);
    table.seatPlayer("bob", 1, 10_000_000n);
    table.startHand("hand-shove");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const sb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    const shoveTo = sb.betThisStreetMojos + sb.stackMojos;
    table.applyAction(sb.playerId, "raise", shoveTo);
    state = table.getHandState()!;
    expect(state.actionSeat).not.toBe(sb.seatIndex);
    const alice = table.getHandState()!.players.find((p) => p.playerId === "alice")!;
    expect(alice.stackMojos).toBe(0n);
    expect(alice.allIn).toBe(true);
  });

  it("heads-up: after a raise the other player must act before the street advances", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-bet-response");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    expect(pre.actionSeat).toBe(0);
    const raiseTo = pre.currentBetMojos + config.bigBlindMojos;
    table.applyAction("alice", "raise", raiseTo);

    const afterRaise = table.getHandState()!;
    expect(afterRaise.street).toBe("preflop");
    expect(afterRaise.actionSeat).toBe(1);
    expect(afterRaise.players.find((p) => p.playerId === "bob")!.betThisStreetMojos).toBeLessThan(
      afterRaise.currentBetMojos,
    );
  });

  it("three-way: limps to the big blind leave the BB an option to act", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 2, 5_000_000_000_000n);
    table.seatPlayer("carol", 5, 5_000_000_000_000n);

    table.startHand("hand-bb-option");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    expect(pre.actionSeat).toBe(0);
    table.applyAction("alice", "call");
    table.applyAction("bob", "call");

    const afterLimp = table.getHandState()!;
    expect(afterLimp.street).toBe("preflop");
    expect(afterLimp.actionSeat).toBe(5);
    expect(afterLimp.players.find((p) => p.seatIndex === 5)!.actedThisStreet).toBe(false);

    table.applyAction("carol", "check");
    expect(table.getHandState()?.street).toBe("flop");
  });

  it("advances to flop after raise and call", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-2");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    const actor = pre.players.find((p) => p.seatIndex === pre.actionSeat)!;
    const other = pre.players.find((p) => p.playerId !== actor.playerId)!;
    const raiseTo = pre.currentBetMojos + config.bigBlindMojos;

    table.applyAction(actor.playerId, "raise", raiseTo);
    expect(table.getHandState()?.street).toBe("preflop");

    table.applyAction(other.playerId, "call");
    const flop = table.getHandState();
    expect(flop?.street).toBe("flop");
    expect(flop?.board).toHaveLength(3);
  });

  it("cashes out player stack when no hand is active", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-3");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    table.applyAction("alice", "fold");

    expect(table.isHandInProgress()).toBe(false);
    expect(table.getPlayerStack("bob")).toBeGreaterThan(5_000_000_000_000n);

    const cashOut = table.cashOutPlayer("bob");
    expect(cashOut.seatIndex).toBe(1);
    expect(cashOut.stackMojos).toBeGreaterThan(5_000_000_000_000n);
    expect(table.getPlayerStack("bob")).toBeNull();
    expect(table.getActivePlayerCount()).toBe(1);
  });

  it("restores hands played and debits a partial stack", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.setHandsPlayed("alice", 50);
    expect(table.getHandsPlayed("alice")).toBe(50);
    const debit = table.debitStack("alice", 50_000_000_000n);
    expect(debit.remaining).toBe(4_950_000_000_000n);
    expect(table.getPlayerStack("alice")).toBe(4_950_000_000_000n);
    expect(table.getHandsPlayed("alice")).toBe(50);
  });

  it("closes preflop when the small blind checks facing a shorter all-in big blind", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 5_000n,
      bigBlindMojos: 10_000n,
      minBuyInMojos: 2_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 10_000_000n);
    table.seatPlayer("bob", 1, 2_000n);
    table.startHand("hand-short-bb");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    expect(pre.street).toBe("preflop");
    expect(pre.players.find((p) => p.playerId === "bob")?.allIn).toBe(true);
    const sb = pre.players.find((p) => p.seatIndex === pre.actionSeat)!;
    expect(sb.betThisStreetMojos).toBeGreaterThan(pre.currentBetMojos);

    table.applyAction(sb.playerId, "check");
    expect(table.getHandState()?.street).not.toBe("preflop");
  });

  it("runs out the board when blinds put every player all-in", () => {
    const short = {
      ...config,
      minBuyInMojos: 1000n,
      smallBlindMojos: 1000n,
      bigBlindMojos: 2000n,
    };
    const table = new NlheTableEngine(short);
    table.seatPlayer("alice", 0, 1000n);
    table.seatPlayer("bob", 1, 1000n);
    table.startHand("hand-allin-blind");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    table.advanceHandIfIdle();
    expect(table.isHandInProgress()).toBe(false);
    expect(table.getLastHandResult()).not.toBeNull();
  });

  it("reloads a zero stack between hands via rebuyStack", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-rebuy");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    table.applyAction("alice", "fold");
    expect(table.getHandState()).toBeNull();
    const internal = table as unknown as { stacks: Map<string, bigint> };
    internal.stacks.set("alice", 0n);
    table.rebuyStack("alice", 5_000_000_000_000n);
    expect(table.getPlayerStack("alice")).toBe(5_000_000_000_000n);
  });

  it("rejects cash out during active hand", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-4");
    expect(() => table.cashOutPlayer("alice")).toThrow(/active hand/i);
  });

  it("seats six-max with three players and awards a fold", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 2, 5_000_000_000_000n);
    table.seatPlayer("dat-poker:house", 5, 5_000_000_000_000n);
    expect(table.getMaxSeats()).toBe(6);
    expect(table.emptySeatIndex()).toBe(1);

    table.startHand("hand-5");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("dat-poker:house", generateServerSeed());
    table.revealAndDeal();

    expect(table.getHandState()?.players).toHaveLength(3);
    const first = table.getHandState()!;
    const actorId = first.players.find((p) => p.seatIndex === first.actionSeat)!.playerId;
    table.applyAction(actorId, "fold");
    expect(table.getHandState()?.players.filter((p) => !p.folded).length).toBe(2);
  });

  it("reveals contesting hole cards after a showdown", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("dat-poker:house", 1, 5_000_000_000_000n);

    table.startHand("hand-6");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("dat-poker:house", generateServerSeed());
    table.revealAndDeal();

    for (let i = 0; i < 40; i++) {
      const hand = table.getHandState();
      if (!hand || hand.actionSeat == null) break;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
      table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
    }

    expect(table.getHandState()).toBeNull();
    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.board).toHaveLength(5);
    expect(result?.shown.length).toBeGreaterThanOrEqual(2);
    expect(result?.shown.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(result?.shown.some((p) => p.playerId === result.winnerId)).toBe(true);
    expect(result?.shown.some((p) => p.playerId !== result.winnerId)).toBe(true);
    expect(result?.shown.find((p) => p.playerId === result.winnerId)?.category).toBeTruthy();
  });

  it("includes losing hole cards in a multi-way showdown", () => {
    const tiny: TableConfig = {
      ...config,
      maxSeats: 3,
      smallBlindMojos: 1n,
      bigBlindMojos: 2n,
      minBuyInMojos: 50n,
      maxBuyInMojos: 500n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 100n);
    table.seatPlayer("bob", 1, 100n);
    table.seatPlayer("carol", 2, 100n);
    table.startHand("hand-multi-show");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();

    for (let i = 0; i < 40; i++) {
      const hand = table.getHandState();
      if (!hand || hand.actionSeat == null) break;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      table.applyAction(actor.playerId, "all-in");
    }

    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    const shownIds = new Set(result?.shown.map((p) => p.playerId) ?? []);
    expect(shownIds.has(result!.winnerId)).toBe(true);
    expect(shownIds.size).toBe(3);
    expect(result?.shown.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(result?.allInPlayerIds).toEqual(expect.arrayContaining(["alice", "bob", "carol"]));
    expect(result?.shown.every((p) => p.allIn)).toBe(true);
  });

  it("does not reveal folded players at showdown", () => {
    const tiny: TableConfig = {
      ...config,
      maxSeats: 4,
      smallBlindMojos: 1n,
      bigBlindMojos: 2n,
      minBuyInMojos: 50n,
      maxBuyInMojos: 500n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 100n);
    table.seatPlayer("bob", 1, 100n);
    table.seatPlayer("carol", 2, 100n);
    table.seatPlayer("dave", 3, 100n);
    table.startHand("hand-muck-folds");
    for (const id of ["alice", "bob", "carol", "dave"]) {
      table.submitPlayerSeed(id, generateServerSeed());
    }
    table.revealAndDeal();

    const folded = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const hand = table.getHandState();
      if (!hand || hand.actionSeat == null) break;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      const live = hand.players.filter((p) => !p.folded);
      if (live.length > 2 && actor.playerId !== "alice" && actor.playerId !== "bob") {
        table.applyAction(actor.playerId, "fold");
        folded.add(actor.playerId);
        continue;
      }
      table.applyAction(actor.playerId, "all-in");
    }

    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    const shownIds = new Set(result?.shown.map((p) => p.playerId) ?? []);
    expect(shownIds.has("carol")).toBe(false);
    expect(shownIds.has("dave")).toBe(false);
    expect(shownIds.has("alice") || shownIds.has("bob")).toBe(true);
    expect(result?.shown.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(folded.size).toBeGreaterThan(0);
    for (const id of folded) {
      expect(shownIds.has(id)).toBe(false);
    }
  });

  it("on a checked-down multi-way pot shows the winning and losing hands, not every player", () => {
    const tiny: TableConfig = {
      ...config,
      maxSeats: 4,
      smallBlindMojos: 1n,
      bigBlindMojos: 2n,
      minBuyInMojos: 50n,
      maxBuyInMojos: 500n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 200n);
    table.seatPlayer("bob", 1, 200n);
    table.seatPlayer("carol", 2, 200n);
    table.seatPlayer("dave", 3, 200n);
    table.startHand("hand-check-down");
    for (const id of ["alice", "bob", "carol", "dave"]) {
      table.submitPlayerSeed(id, generateServerSeed());
    }
    table.revealAndDeal();

    for (let i = 0; i < 80; i++) {
      const hand = table.getHandState();
      if (!hand || hand.actionSeat == null) break;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
      table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
    }

    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.shown.length).toBe(2);
    expect(result?.shown.some((p) => p.playerId === result.winnerId)).toBe(true);
    expect(result?.shown.some((p) => p.playerId !== result.winnerId)).toBe(true);
    expect(result?.shown.every((p) => p.holeCards.length === 2)).toBe(true);
  });

  it("posts small and big blind relative to the dealer button", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 2, 5_000_000_000_000n);
    table.seatPlayer("carol", 5, 5_000_000_000_000n);

    table.startHand("hand-blinds");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();

    const state = table.getHandState()!;
    expect(state.dealerSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(2);
    expect(state.bigBlindSeat).toBe(5);
    expect(state.actionSeat).toBe(0);
    const sb = state.players.find((p) => p.seatIndex === 2)!;
    const bb = state.players.find((p) => p.seatIndex === 5)!;
    expect(sb.betThisStreetMojos).toBe(config.smallBlindMojos);
    expect(bb.betThisStreetMojos).toBe(config.bigBlindMojos);
    expect(state.currentBetMojos).toBe(config.bigBlindMojos);
  });

  it("rotates the dealer button clockwise after each completed hand", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.seatPlayer("carol", 2, 5_000_000_000_000n);

    table.startHand("hand-d1");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();
    expect(table.getHandState()?.dealerSeat).toBe(0);

    const firstActor = table.getHandState()!.players.find(
      (p) => p.seatIndex === table.getHandState()!.actionSeat,
    )!.playerId;
    table.applyAction(firstActor, "fold");
    const secondActor = table.getHandState()!.players.find(
      (p) => p.seatIndex === table.getHandState()!.actionSeat,
    )!.playerId;
    table.applyAction(secondActor, "fold");
    expect(table.getHandState()).toBeNull();

    table.startHand("hand-d2");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();
    expect(table.getHandState()?.dealerSeat).toBe(1);
  });

  it("heads-up: dealer posts small blind and acts first preflop", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-hu");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const state = table.getHandState()!;
    expect(state.dealerSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(1);
    expect(state.actionSeat).toBe(0);
    expect(state.players.find((p) => p.seatIndex === 0)!.betThisStreetMojos).toBe(
      config.smallBlindMojos,
    );
    expect(state.players.find((p) => p.seatIndex === 1)!.betThisStreetMojos).toBe(
      config.bigBlindMojos,
    );
  });

  it("refunds this-hand bets when a hand is aborted for restart", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-abort");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    table.abortHandRefundBets();
    expect(table.isHandInProgress()).toBe(false);
    expect(table.getPlayerStack("alice")).toBe(5_000_000_000_000n);
    expect(table.getPlayerStack("bob")).toBe(5_000_000_000_000n);
  });

  it("marks a short call as all-in and records a runout from that street", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 50n,
      bigBlindMojos: 100n,
      minBuyInMojos: 200n,
      maxBuyInMojos: 20_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 400n);
    table.seatPlayer("bob", 1, 10_000n);
    table.startHand("hand-short-call");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    const pre = table.getHandState()!;
    const first = pre.players.find((p) => p.seatIndex === pre.actionSeat)!;
    const second = pre.players.find((p) => p.playerId !== first.playerId)!;
    table.applyAction(first.playerId, "call");
    table.applyAction(second.playerId, "check");
    const flop = table.getHandState()!;
    expect(flop.street).toBe("flop");
    const shover = flop.players.find((p) => p.playerId === "bob" && p.seatIndex === flop.actionSeat)
      ?? flop.players.find((p) => p.seatIndex === flop.actionSeat)!;
    if (shover.playerId !== "bob") {
      table.applyAction(shover.playerId, "check");
    }
    const toShove = table.getHandState()!;
    const actor = toShove.players.find((p) => p.seatIndex === toShove.actionSeat)!;
    if (actor.playerId === "bob") {
      table.applyAction("bob", "all-in");
    } else {
      table.applyAction(actor.playerId, "check");
      table.applyAction("bob", "all-in");
    }
    const facing = table.getHandState();
    if (facing) {
      const caller = facing.players.find((p) => p.seatIndex === facing.actionSeat)!;
      table.applyAction(caller.playerId, "call");
    }
    expect(table.getHandState()).toBeNull();
    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.allInPlayerIds).toContain("alice");
    expect(result?.runoutFromBoardLen).toBe(3);
  });

  it("runs remaining streets from the flop when heads-up all-in betting closes", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 50n,
      bigBlindMojos: 100n,
      minBuyInMojos: 1_000n,
      maxBuyInMojos: 50_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 10_000n);
    table.seatPlayer("bob", 1, 10_000n);
    table.startHand("hand-flop-allin");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    const pre = table.getHandState()!;
    const first = pre.players.find((p) => p.seatIndex === pre.actionSeat)!;
    const second = pre.players.find((p) => p.playerId !== first.playerId)!;
    table.applyAction(first.playerId, "call");
    table.applyAction(second.playerId, "check");
    expect(table.getHandState()?.street).toBe("flop");
    expect(table.getHandState()?.board).toHaveLength(3);

    const flop = table.getHandState()!;
    const actor = flop.players.find((p) => p.seatIndex === flop.actionSeat)!;
    table.applyAction(actor.playerId, "all-in");
    const other = table.getHandState()?.players.find((p) => p.playerId !== actor.playerId);
    if (other && table.getHandState()) {
      table.applyAction(other.playerId, "call");
    }
    expect(table.getHandState()).toBeNull();
    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.board).toHaveLength(5);
    expect(result?.runoutFromBoardLen).toBe(3);
  });

  it("keeps later streets open when two players can still bet after an all-in", () => {
    const tiny: TableConfig = {
      ...config,
      smallBlindMojos: 50n,
      bigBlindMojos: 100n,
      minBuyInMojos: 1_000n,
      maxBuyInMojos: 50_000n,
    };
    const table = new NlheTableEngine(tiny);
    table.seatPlayer("alice", 0, 2_000n);
    table.seatPlayer("bob", 1, 10_000n);
    table.seatPlayer("carol", 2, 10_000n);
    table.startHand("hand-side-pot");
    for (const id of ["alice", "bob", "carol"]) {
      table.submitPlayerSeed(id, generateServerSeed());
    }
    table.revealAndDeal();
    for (let i = 0; i < 8; i++) {
      const hand = table.getHandState();
      if (!hand || hand.street !== "preflop" || hand.actionSeat == null) break;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
      table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
    }
    expect(table.getHandState()?.street).toBe("flop");
    for (let i = 0; i < 8; i++) {
      const hand = table.getHandState();
      if (!hand || hand.street !== "flop" || hand.actionSeat == null) break;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      if (actor.playerId === "alice" && !actor.allIn) {
        table.applyAction("alice", "all-in");
        continue;
      }
      const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
      table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
    }
    const turn = table.getHandState();
    expect(turn?.street).toBe("turn");
    expect(turn?.actionSeat).not.toBeNull();
    expect(turn?.players.filter((p) => !p.folded && !p.allIn).length).toBe(2);
    expect(table.getLastHandResult()).toBeNull();
  });

  it("lets a human take over a house seat between hands", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("dat-poker:house:1", 1, 3_000_000_000_000n);
    const claimed = table.claimHouseSeat("alice", 1);
    expect(claimed.replacedPlayerId).toBe("dat-poker:house:1");
    expect(claimed.stackMojos).toBe(3_000_000_000_000n);
    expect(table.hasPlayer("alice")).toBe(true);
    expect(table.hasPlayer("dat-poker:house:1")).toBe(false);
  });
});
