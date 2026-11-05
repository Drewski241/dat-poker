import { describe, expect, it } from "vitest";
import { createCommit, generateServerSeed, buildShuffleEntropy, shuffleDeck } from "./shuffle.js";
import { standardDeck } from "./card.js";
import { verifyHandFairness } from "./fairness.js";

describe("verifyHandFairness", () => {
  it("accepts a matching commit/reveal and fingerprints the deck", () => {
    const serverSeed = generateServerSeed();
    const { commitHash } = createCommit(serverSeed);
    const playerSeeds = { alice: generateServerSeed(), bob: generateServerSeed() };
    const result = verifyHandFairness({ commitHash, serverSeed, playerSeeds });
    expect(result.ok).toBe(true);
    expect(result.commitMatches).toBe(true);
    expect(result.deckPrefix).toHaveLength(8);

    const expected = shuffleDeck(
      standardDeck(),
      buildShuffleEntropy(serverSeed, playerSeeds),
    )
      .slice(0, 8)
      .map((c) => `${c.rank}${c.suit}`);
    expect(result.deckPrefix).toEqual(expected);
  });

  it("rejects a tampered server seed", () => {
    const serverSeed = generateServerSeed();
    const { commitHash } = createCommit(serverSeed);
    const result = verifyHandFairness({
      commitHash,
      serverSeed: generateServerSeed(),
      playerSeeds: { alice: "aa" },
    });
    expect(result.ok).toBe(false);
    expect(result.commitMatches).toBe(false);
  });
});
