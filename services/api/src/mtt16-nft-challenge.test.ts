import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  flushMtt16NftOfferForTests,
  mtt16NftChallengePublicView,
  mtt16NftRewardForPlayer,
  recordMtt16FirstPlaceWin,
  resetMtt16NftChallengeForTests,
  retryMtt16NftOffer,
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

  it("tracks wins and awards the first player to reach the required count", async () => {
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

  it("starts a fresh race when the prize NFT id changes", () => {
    process.env.DAT_MTT16_NFT_REWARD_ID = "nft1oldprize000000000000000000000000000000000000000000000000";
    resetMtt16NftChallengeForTests();
    for (let i = 0; i < 5; i += 1) {
      recordMtt16FirstPlaceWin("xch1alice", "xch1alice");
    }
    expect(mtt16NftChallengePublicView().awarded).toBe(true);

    process.env.DAT_MTT16_NFT_REWARD_ID = "nft13sew37qescuqyxzjvsn3dv232f8aa9xjtfytequa6l5p084svf3s85vxrc";
    const view = mtt16NftChallengePublicView("xch1alice");
    expect(view.nftId).toBe("nft13sew37qescuqyxzjvsn3dv232f8aa9xjtfytequa6l5p084svf3s85vxrc");
    expect(view.awarded).toBe(false);
    expect(view.yourWins).toBe(0);
    expect(view.winsRequired).toBe(5);
    expect(recordMtt16FirstPlaceWin("xch1bob", "xch1bob")).toBe(false);
    expect(mtt16NftChallengePublicView("xch1bob").yourWins).toBe(1);
  });

  it("cache-busts the lobby image URL with the current prize nft id", async () => {
    const nftId = "nft13sew37qescuqyxzjvsn3dv232f8aa9xjtfytequa6l5p084svf3s85vxrc";
    process.env.DAT_MTT16_NFT_REWARD_ID = nftId;
    process.env.DAT_MTT16_NFT_WINS_REQUIRED = "20";
    resetMtt16NftChallengeForTests();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("mintgarden")) {
        return new Response(JSON.stringify({ data: { thumbnail_uri: "https://cdn.example/bear.png" } }), {
          status: 200,
        });
      }
      if (url.includes("coinset.org/nft/") && url.endsWith(".json")) {
        return new Response(
          JSON.stringify({ data: { description: "New prize bear", series_number: 1, series_total: 1 } }),
          { status: 200 },
        );
      }
      return new Response("nope", { status: 404 });
    };
    try {
      const { getMtt16NftPromoMeta } = await import("./mtt16-nft-challenge-store.js");
      await getMtt16NftPromoMeta();
      const view = mtt16NftChallengePublicView();
      expect(view.winsRequired).toBe(20);
      expect(view.description).toBe("New prize bear");
      expect(view.imageUrl).toBe(`/v1/lobby/mtt16-nft-image?nft=${encodeURIComponent(nftId)}`);
      expect(view.awarded).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries a failed treasury NFT payout once treasury is fixed", async () => {
    const player = "xch1alice";
    for (let i = 0; i < 5; i += 1) {
      recordMtt16FirstPlaceWin(player, player);
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
      return new Response(JSON.stringify({ offer: "offer1retry", feeMojos: "500000000" }), { status: 200 });
    };
    try {
      await flushMtt16NftOfferForTests();
      expect(mtt16NftRewardForPlayer(player).offerError).toMatch(/404/);
      expect(mtt16NftRewardForPlayer(player).offer).toBeNull();

      const retry = await retryMtt16NftOffer(player);
      expect(retry.retried).toBe(true);
      expect(mtt16NftRewardForPlayer(player).offer).toBe("offer1retry");
      expect(mtt16NftRewardForPlayer(player).offerError).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
