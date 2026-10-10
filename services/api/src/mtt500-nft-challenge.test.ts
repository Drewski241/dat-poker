import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  flushMtt500NftOfferForTests,
  mtt500NftChallengePublicView,
  mtt500NftRewardForPlayer,
  recordMtt500FirstPlaceWin,
  resetMtt500NftChallengeForTests,
  retryMtt500NftOffer,
} from "./mtt500-nft-challenge-store.js";

describe("large-field MTT NFT challenge", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.DAT_MTT500_NFT_CHALLENGE_PATH = "memory";
    process.env.DAT_MTT500_NFT_WINS_REQUIRED = "5";
    process.env.DAT_TREASURY_NFT_PAYOUT_URL = "http://127.0.0.1:9/nft-payout";
    resetMtt500NftChallengeForTests();
  });

  afterEach(() => {
    process.env = env;
  });

  it("tracks wins and awards the first player to reach the required count", async () => {
    const player = "xch1alice";
    for (let i = 0; i < 4; i += 1) {
      expect(recordMtt500FirstPlaceWin(player, player)).toBe(false);
    }
    expect(recordMtt500FirstPlaceWin(player, player)).toBe(true);

    const view = mtt500NftChallengePublicView(player);
    expect(view.yourWins).toBe(5);
    expect(view.awarded).toBe(true);
    expect(view.winnerPlayerId).toBe(player);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          offer: "offer1test500",
          feeMojos: "500000000",
        }),
        { status: 200 },
      );
    try {
      await flushMtt500NftOfferForTests();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const reward = mtt500NftRewardForPlayer(player);
    expect(reward.eligible).toBe(true);
    expect(reward.offer).toBe("offer1test500");
    expect(reward.feeMojos).toBe("500000000");
  });

  it("does not double-award after a winner exists", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMtt500FirstPlaceWin("xch1alice", "xch1alice");
    }
    for (let i = 0; i < 10; i += 1) {
      recordMtt500FirstPlaceWin("xch1bob", "xch1bob");
    }
    expect(mtt500NftChallengePublicView().winnerPlayerId).toBe("xch1alice");
    expect(mtt500NftChallengePublicView("xch1bob").yourWins).toBe(0);
  });

  it("defaults to the configured beta prize NFT id", () => {
    delete process.env.DAT_MTT500_NFT_REWARD_ID;
    resetMtt500NftChallengeForTests();
    expect(mtt500NftChallengePublicView().nftId).toBe(
      "nft1vg5alplpueqgmrq5t4nuy0gemyn2zu43l9g9udz2jz60e6m45ncq76dsnc",
    );
    expect(mtt500NftChallengePublicView().winsRequired).toBe(5);
  });

  it("retries a failed treasury NFT payout once treasury is fixed", async () => {
    const player = "xch1alice";
    for (let i = 0; i < 5; i += 1) {
      recordMtt500FirstPlaceWin(player, player);
    }

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: "Route POST:/nft-payout not found", statusCode: 404 }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ offer: "offer1retry500", feeMojos: "500000000" }), { status: 200 });
    };
    try {
      await flushMtt500NftOfferForTests();
      expect(mtt500NftRewardForPlayer(player).offerError).toMatch(/404/);
      expect(mtt500NftRewardForPlayer(player).offer).toBeNull();

      const retry = await retryMtt500NftOffer(player);
      expect(retry.retried).toBe(true);
      expect(mtt500NftRewardForPlayer(player).offer).toBe("offer1retry500");
      expect(mtt500NftRewardForPlayer(player).offerError).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
