import { verifyCommit, buildShuffleEntropy, shuffleDeck, hashSeed } from "./shuffle.js";
import { standardDeck, type Card } from "./card.js";

export interface HandFairnessMaterial {
  commitHash: string;
  serverSeed: string;
  playerSeeds: Record<string, string>;
}

export interface FairnessVerifyResult {
  ok: boolean;
  commitMatches: boolean;
  entropy: string;
  /** First 8 cards of the reconstructed shuffle (quick fingerprint). */
  deckPrefix: string[];
  issues: string[];
}

/** Recompute commit + shuffle entropy so clients can verify a revealed hand. */
export function verifyHandFairness(material: HandFairnessMaterial): FairnessVerifyResult {
  const issues: string[] = [];
  const commitMatches = verifyCommit(material.serverSeed, material.commitHash);
  if (!commitMatches) {
    issues.push("serverSeed does not match commitHash");
  }
  if (!material.serverSeed.trim()) {
    issues.push("serverSeed is empty");
  }
  const entropy = buildShuffleEntropy(material.serverSeed, material.playerSeeds);
  const deck = shuffleDeck(standardDeck(), entropy);
  const deckPrefix = deck.slice(0, 8).map((c: Card) => `${c.rank}${c.suit}`);
  return {
    ok: issues.length === 0 && commitMatches,
    commitMatches,
    entropy: hashSeed(entropy).slice(0, 16),
    deckPrefix,
    issues,
  };
}
