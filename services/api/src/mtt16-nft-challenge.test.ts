import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  flushMtt16NftOfferForTests,
  mtt16NftChallengePublicView,
  mtt16NftRewardForPlayer,
  recordMtt16FirstPlaceWin,
  resetMtt16NftChallengeForTests,
} from "./mtt16-nft-challenge-store.js";

describe("16-player SNG NFT challenge", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.DAT_MTT16_NFT_CHALLENGE_PATH = "memory";
    process.env.DAT_MTT16_NFT_WINS_REQUIRED = "5";
    process.env.DAT_TREASURY_NFT_PAYOUT_URL = "http://127.0.0.1:9/nft-payout";
    resetMtt16NftChallengeForTests();
  });

  afterEach(() => {
    process.env = env;
  });

  it("tracks wins and awards the first player to reach five", async () => {
    const player = "xch1alice";
    for (let i = 0; i < 4; i += 1) {
      expect(recordMtt16FirstPlaceWin(player, player)).toBe(false);
    }
    expect(recordMtt16FirstPlaceWin(player, player)).toBe(true);

    const view = mtt16NftChallengePublicView(player);
    expect(view.yourWins).toBe(5);
    expect(view.awarded).toBe(true);
    expect(view.winnerPlayerId).toBe(player);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          offer: "offer1test",
          feeMojos: "500000000",
        }),
        { status: 200 },
      );
    try {
      await flushMtt16NftOfferForTests();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const reward = mtt16NftRewardForPlayer(player);
    expect(reward.eligible).toBe(true);
    expect(reward.offer).toBe("offer1test");
    expect(reward.feeMojos).toBe("500000000");
  });

  it("does not double-award after a winner exists", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMtt16FirstPlaceWin("xch1alice", "xch1alice");
    }
    for (let i = 0; i < 10; i += 1) {
      recordMtt16FirstPlaceWin("xch1bob", "xch1bob");
    }
    expect(mtt16NftChallengePublicView().winnerPlayerId).toBe("xch1alice");
    expect(mtt16NftChallengePublicView("xch1bob").yourWins).toBe(0);
  });
});
