import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TOURNAMENT_POOL_MOD_HASH,
  buildRefundSpend,
  buildSettleSpend,
  compiledPuzzleModHash,
  planTournamentDisbursement,
  prizesForFinish,
  tournamentCatPuzzleHash,
  tournamentPoolPuzzleHash,
} from "./tournament-pool.js";

const PARAMS = {
  chainTournamentId: "11".repeat(32),
  buyInMojos: 1_000_000n,
  playerPuzzleHash: "22".repeat(32),
  authorizerPublicKey: "33".repeat(48),
  refundAfterSeconds: 3600,
};

describe("tournament pool puzzle", () => {
  it("matches the compiled mod hash", () => {
    const hex = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../puzzles/tournament_pool.hex"),
      "utf8",
    );
    expect(compiledPuzzleModHash(hex)).toBe(TOURNAMENT_POOL_MOD_HASH);
  });

  it("curries the entry coin to the hash produced by clvm_tools", () => {
    expect(tournamentPoolPuzzleHash(PARAMS)).toBe(
      "0cff93f4dc20021d4718b67c0bd590ab2bfbdaeafc58bfecfb80cca3becd6669",
    );
  });

  it("wraps the entry as a CAT v2 coin for the DAT asset id", () => {
    expect(tournamentCatPuzzleHash(PARAMS, "ab".repeat(32))).toBe(
      "4fc50a9a3a9a19229f9467ca24fccbb352f80a4e069dab4801c5f4dae69bc62d",
    );
  });

  it("builds the refund solution clvm_tools accepted", () => {
    const spend = buildRefundSpend(PARAMS);
    expect(spend.solutionHex).toBe("ff80ff8080");
    expect(spend.authorizerMessage).toBeNull();
    expect(spend.outputs).toEqual([
      { puzzleHash: PARAMS.playerPuzzleHash, amountMojos: PARAMS.buyInMojos },
    ]);
  });

  it("builds the settle solution and authorizer message the puzzle checks", () => {
    const full = buildSettleSpend(PARAMS, [
      { puzzleHash: PARAMS.playerPuzzleHash, amountMojos: PARAMS.buyInMojos },
    ]);
    expect(full.solutionHex).toBe(
      "ff01ffffffa02222222222222222222222222222222222222222222222222222222222222222830f42408080",
    );
    expect(full.authorizerMessage).toBe(
      "e2b7cf245c51e962abf56c8b537a2c0ddb9680194cff24f1f0132ca4e6c2118a",
    );

    const split = buildSettleSpend(PARAMS, [
      { puzzleHash: "aa".repeat(32), amountMojos: 600_000n },
      { puzzleHash: "bb".repeat(32), amountMojos: 400_000n },
    ]);
    expect(split.solutionHex).toBe(
      "ff01ffffffa0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa830927c0ffffa0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb83061a808080",
    );
    expect(split.authorizerMessage).toBe(
      "1991982f73476d3bd8e0c02361941ba5baa9f549c6b39ce65526181b609d5cb5",
    );
  });

  it("rejects a settle that does not conserve the buy-in", () => {
    expect(() =>
      buildSettleSpend(PARAMS, [{ puzzleHash: "aa".repeat(32), amountMojos: 1n }]),
    ).toThrow(/sum to the buy-in/);
  });
});

describe("prize disbursement", () => {
  it("gives odd mojos to first place", () => {
    const prizes = prizesForFinish(1001n, [5000, 3000, 2000], [
      { address: "a", puzzleHash: "aa".repeat(32) },
      { address: "b", puzzleHash: "bb".repeat(32) },
      { address: "c", puzzleHash: "cc".repeat(32) },
    ]);
    expect(prizes.map((prize) => prize.amountMojos)).toEqual([501n, 300n, 200n]);
  });

  it("fills pool coins before spending site-ledger collateral", () => {
    const plan = planTournamentDisbursement({
      buyInMojos: 1000n,
      poolPlayerPuzzleHashes: ["11".repeat(32), "22".repeat(32)],
      siteMojos: 1000n,
      payouts: [
        { address: "winner", puzzleHash: "aa".repeat(32), amountMojos: 2500n },
        { address: "second", puzzleHash: "bb".repeat(32), amountMojos: 500n },
      ],
    });
    expect(plan.coinSpends).toEqual([
      {
        playerPuzzleHash: "11".repeat(32),
        outputs: [{ puzzleHash: "aa".repeat(32), amountMojos: 1000n }],
      },
      {
        playerPuzzleHash: "22".repeat(32),
        outputs: [{ puzzleHash: "aa".repeat(32), amountMojos: 1000n }],
      },
    ]);
    expect(plan.siteCredits).toEqual([
      { address: "winner", puzzleHash: "aa".repeat(32), amountMojos: 500n },
      { address: "second", puzzleHash: "bb".repeat(32), amountMojos: 500n },
    ]);
  });

  it("splits one entry coin across two winners", () => {
    const plan = planTournamentDisbursement({
      buyInMojos: 1000n,
      poolPlayerPuzzleHashes: ["11".repeat(32)],
      siteMojos: 0n,
      payouts: [
        { address: "a", puzzleHash: "aa".repeat(32), amountMojos: 400n },
        { address: "b", puzzleHash: "bb".repeat(32), amountMojos: 600n },
      ],
    });
    const outputs = plan.coinSpends[0]?.outputs ?? [];
    expect(outputs).toEqual([
      { puzzleHash: "aa".repeat(32), amountMojos: 400n },
      { puzzleHash: "bb".repeat(32), amountMojos: 600n },
    ]);
    expect(plan.siteCredits).toEqual([]);
  });
});
