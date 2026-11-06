import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { generateServerSeed } from "@dat-poker/game-engine";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests } from "./account-store.js";
import { registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { resetMailOutboxForTests } from "./mail.js";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { issueTestSession, resetPlayerSessionsForTests } from "./player-session.js";
import { resetIpRateLimitsForTests } from "./ip-rate-limit.js";
import { HOUSE_PLAYER_ID } from "./house-id.js";

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
  registerAuthRoutes(app);
  registerSessionRoutes(app);
  registerWalletRoutes(app, chia);
  registerTableRoutes(app);
  registerHandRoutes(app);
  return app;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("house acts on table poll", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_EMAIL_MODE = "memory";
    process.env.DAT_PLAY_COMPLIANCE_MODE = "test";
    process.env.DAT_TERMS_ACCEPTANCE_PATH = "memory";
    resetMailOutboxForTests();
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
  });

  it("GET /v1/tables/:id advances the house when it is to act", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1alice-house-poll");

    await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, devAck: true },
    });

    const join = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    const { tableId } = JSON.parse(join.body) as { tableId: string };

    const go = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/go`,
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId },
    });
    expect(go.statusCode).toBe(200);
    const goBody = JSON.parse(go.body) as { hand: { handId: string } | null };
    expect(goBody.hand).not.toBeNull();

    await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/seed`,
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, seed: generateServerSeed() },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/seed`,
      headers: auth(alice.token),
      payload: { playerId: HOUSE_PLAYER_ID, seed: generateServerSeed() },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/deal`,
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId },
    });

    const beforePoll = await app.inject({
      method: "GET",
      url: `/v1/tables/${tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });
    const before = JSON.parse(beforePoll.body) as {
      hand: { actionSeat: number | null; players: { playerId: string; seatIndex: number }[] } | null;
      handInProgress: boolean;
    };
    expect(before.handInProgress).toBe(true);
    if (before.hand?.actionSeat != null) {
      const actor = before.hand.players.find((p) => p.seatIndex === before.hand!.actionSeat);
      if (actor?.playerId === HOUSE_PLAYER_ID) {
        const afterPoll = await app.inject({
          method: "GET",
          url: `/v1/tables/${tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
          headers: auth(alice.token),
        });
        const after = JSON.parse(afterPoll.body) as {
          hand: { actionSeat: number | null; players: { playerId: string; seatIndex: number }[] } | null;
        };
        if (after.hand?.actionSeat != null) {
          const afterActor = after.hand.players.find((p) => p.seatIndex === after.hand!.actionSeat);
          expect(afterActor?.playerId).not.toBe(HOUSE_PLAYER_ID);
        }
      }
    }
  });
});
