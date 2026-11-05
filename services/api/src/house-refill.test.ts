import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests } from "./account-store.js";
import { getTableEngine, registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { resetUsersForTests } from "./user-store.js";
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

describe("house refill", () => {
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
    resetUsersForTests();
    resetIpRateLimitsForTests();
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
    process.env.DAT_DAILY_REDEEM_MOJOS = "5000000";
  });

  it("refills the house when seated with zero stack on table poll", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1alice-house-refill");

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
    expect(join.statusCode).toBe(200);
    const { tableId } = JSON.parse(join.body) as { tableId: string };

    const engine = getTableEngine(tableId)!;
    expect(engine.hasPlayer(HOUSE_PLAYER_ID)).toBe(true);
    const internal = engine as unknown as { stacks: Map<string, bigint> };
    internal.stacks.set(HOUSE_PLAYER_ID, 0n);

    const poll = await app.inject({
      method: "GET",
      url: `/v1/tables/${tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });
    expect(poll.statusCode).toBe(200);
    const body = JSON.parse(poll.body) as { seats: { playerId: string; stackMojos: string }[] };
    const house = body.seats.find((s) => s.playerId === HOUSE_PLAYER_ID);
    expect(house?.stackMojos).toBe("1000000");
  });
});
