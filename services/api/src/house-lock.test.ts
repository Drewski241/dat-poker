import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { resetAccountsForTests, tryRedeemDaily } from "./account-store.js";
import { resetHeadsUpChannelsForTests } from "./heads-up-channel.js";
import { resetHouseTreasuryForTests } from "./house-lock.js";
import { issueTestSession, resetPlayerSessionsForTests } from "./player-session.js";
import { registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { serializeForJson } from "./serialize.js";

const BUY_IN = "1000000";

function app() {
  const api = Fastify();
  api.addHook("preSerialization", async (_request, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  const chia = new ChiaGamingClient({
    network: "testnet",
    lobbyUrl: "http://localhost:3001",
    gameUrl: "http://localhost:3000",
    coinsetUrl: "https://testnet11.api.coinset.org",
  });
  registerWalletRoutes(api, chia);
  registerTableRoutes(api);
  return api;
}

describe("heads-up house treasury lock", () => {
  const previous = {
    dev: process.env.DAT_ALLOW_DEV_BUYIN,
    bankroll: process.env.DAT_TREASURY_BANKROLL_MOJOS,
    payout: process.env.DAT_TREASURY_PAYOUT_URL,
    min: process.env.DAT_MIN_BUY_IN_MOJOS,
  };

  beforeEach(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_TREASURY_BANKROLL_MOJOS = BUY_IN;
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    process.env.DAT_MIN_BUY_IN_MOJOS = BUY_IN;
    resetHouseTreasuryForTests();
    resetHeadsUpChannelsForTests();
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
  });

  afterAll(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = previous.dev;
    if (previous.bankroll === undefined) delete process.env.DAT_TREASURY_BANKROLL_MOJOS;
    else process.env.DAT_TREASURY_BANKROLL_MOJOS = previous.bankroll;
    if (previous.payout === undefined) delete process.env.DAT_TREASURY_PAYOUT_URL;
    else process.env.DAT_TREASURY_PAYOUT_URL = previous.payout;
    if (previous.min === undefined) delete process.env.DAT_MIN_BUY_IN_MOJOS;
    else process.env.DAT_MIN_BUY_IN_MOJOS = previous.min;
    resetHouseTreasuryForTests();
    resetHeadsUpChannelsForTests();
  });

  it("locks one house buy-in and frees it when that tester cashes out", async () => {
    const api = app();
    const alice = issueTestSession("xch1alicehu");
    const bob = issueTestSession("xch1bobhu");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    tryRedeemDaily(bob.session.playerId, 5_000_000n);

    const first = await api.inject({
      method: "POST",
      url: "/v1/tables/join-heads-up",
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { playerId: alice.session.playerId, buyInMojos: BUY_IN, variant: "plo4" },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().maxSeats).toBe(2);
    expect(first.json().headsUp.houseLocked).toBe(true);
    expect(first.json().headsUp.wagerAsset).toBe("dat");
    expect(first.json().headsUp.xchWagerMojos).toBe("0");

    const refused = await api.inject({
      method: "POST",
      url: "/v1/tables/join-heads-up",
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { playerId: bob.session.playerId, buyInMojos: BUY_IN, variant: "nlhe" },
    });
    expect(refused.statusCode).toBe(409);

    const left = await api.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { tableId: first.json().tableId, playerId: alice.session.playerId, toAccount: true },
    });
    expect(left.statusCode, left.body).toBe(200);

    const accepted = await api.inject({
      method: "POST",
      url: "/v1/tables/join-heads-up",
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { playerId: bob.session.playerId, buyInMojos: BUY_IN, variant: "nlhe" },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().headsUp.variant).toBe("nlhe");
    await api.close();
  });
});
