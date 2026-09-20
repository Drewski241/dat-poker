import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests, tryRedeemDaily } from "./account-store.js";
import { registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { registerSessionRoutes } from "./routes/session.js";
import { resetHandHistoryForTests } from "./hand-history-store.js";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { issueTestSession, resetPlayerSessionsForTests } from "./player-session.js";
import { resetIpRateLimitsForTests } from "./ip-rate-limit.js";

async function buildApp() {
  const app = Fastify();
  app.addHook("preSerialization", async (_req, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  const chia = new ChiaGamingClient({
    network: "mainnet",
    lobbyUrl: "http://localhost:3001",
    gameUrl: "http://localhost:3000",
    coinsetUrl: "https://coinset.org",
  });
  registerSessionRoutes(app);
  registerWalletRoutes(app, chia);
  registerTableRoutes(app);
  registerHandRoutes(app);
  return app;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("hand history", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
    resetHandHistoryForTests();
  });

  it("records a completed hand with per-player contributions", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1alice-hist");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);

    const joined = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tables/join",
          headers: auth(alice.token),
          payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
        })
      ).body,
    ) as { tableId: string };

    const go = await app.inject({
      method: "POST",
      url: `/v1/tables/${joined.tableId}/hands/go`,
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId },
    });
    expect(go.statusCode).toBe(200);
    let snap = JSON.parse(go.body) as { hand: unknown; handInProgress?: boolean };
    for (let i = 0; i < 40 && (snap.hand || snap.handInProgress); i++) {
      const poll = await app.inject({
        method: "GET",
        url: `/v1/tables/${joined.tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
        headers: auth(alice.token),
      });
      snap = JSON.parse(poll.body);
      if (snap.hand?.actionSeat != null) {
        const hand = snap.hand as {
          actionSeat: number;
          players: { playerId: string; seatIndex: number; allIn?: boolean; folded?: boolean }[];
        };
        const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat);
        if (actor?.playerId === alice.session.playerId && !actor.allIn && !actor.folded) {
          await app.inject({
            method: "POST",
            url: `/v1/tables/${joined.tableId}/hands/action`,
            headers: auth(alice.token),
            payload: { playerId: alice.session.playerId, action: "fold" },
          });
        }
      }
    }

    const fold = await app.inject({
      method: "GET",
      url: `/v1/tables/${joined.tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });
    expect(fold.statusCode).toBe(200);

    const history = await app.inject({
      method: "GET",
      url: `/v1/tables/${joined.tableId}/hand-history?playerId=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });
    expect(history.statusCode).toBe(200);
    const body = JSON.parse(history.body) as {
      hands: { handId: string; potMojos: string; participants: { totalBetHandMojos: string }[] }[];
    };
    expect(body.hands.length).toBeGreaterThanOrEqual(1);
    expect(body.hands[0].participants.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});
