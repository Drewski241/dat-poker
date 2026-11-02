import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TOURNAMENT_POOL_MOD_HASH,
  MAX_PAYOUTS,
  buildRefundSpend,
  buildSettleSpend,
  compiledPuzzleModHash,
  paidPlaceCount,
  payoutBpsForField,
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

describe("top 20% payout curve", () => {
  it("pays one place under 8 and scales with the field", () => {
    expect(paidPlaceCount(2)).toBe(1);
    expect(paidPlaceCount(7)).toBe(1);
    expect(paidPlaceCount(8)).toBe(2);
    expect(paidPlaceCount(9)).toBe(2);
    expect(paidPlaceCount(16)).toBe(3);
    expect(paidPlaceCount(100)).toBe(20);
    expect(payoutBpsForField(2)).toEqual([10_000]);
    expect(payoutBpsForField(8)).toEqual([6667, 3333]);
    expect(payoutBpsForField(16)).toEqual([5001, 3333, 1666]);
    expect(payoutBpsForField(100)).toHaveLength(20);
    for (const field of [2, 8, 16, 100]) {
      const bps = payoutBpsForField(field);
      expect(bps.reduce((sum, share) => sum + share, 0)).toBe(10_000);
      expect(bps.every((share) => share > 0)).toBe(true);
    }
  });

  it("keeps each entry coin within the puzzle's 16 outputs", () => {
    for (const field of [2, 8, 16, 100]) {
      const bps = payoutBpsForField(field);
      const finish = bps.map((_, index) => ({
        address: `p${index}`,
        puzzleHash: (index + 1).toString(16).padStart(64, "0"),
      }));
      const prizes = prizesForFinish(1_000n * BigInt(field), bps, finish);
      const plan = planTournamentDisbursement({
        buyInMojos: 1_000n,
        poolPlayerPuzzleHashes: Array.from({ length: field }, (_, index) =>
          (index + 1).toString(16).padStart(64, "f"),
        ),
        siteMojos: 0n,
        payouts: prizes,
      });
      const widest = Math.max(...plan.coinSpends.map((coin) => coin.outputs.length));
      expect(widest).toBeLessThanOrEqual(MAX_PAYOUTS);
    }
  });

  it("pays a single real coin in one output when the house covers the rest", () => {
    const field = 500;
    const bps = payoutBpsForField(field);
    const finish = bps.map((_, index) => ({
      address: `p${index}`,
      puzzleHash: (index + 1).toString(16).padStart(64, "0"),
    }));
    const prizes = prizesForFinish(1_000n * BigInt(field), bps, finish);
    const plan = planTournamentDisbursement({
      buyInMojos: 1_000n,
      poolPlayerPuzzleHashes: ["d".repeat(32)],
      siteMojos: 1_000n * BigInt(field - 1),
      payouts: prizes,
    });
    expect(plan.coinSpends[0]?.outputs).toEqual([
      { puzzleHash: "1".padStart(64, "0"), amountMojos: 1_000n },
    ]);
  });
});
