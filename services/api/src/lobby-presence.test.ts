import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests } from "./account-store.js";
import {
  getTableEngine,
  lobbyPresence,
  registerTableRoutes,
  resetTablesForTests,
} from "./routes/tables.js";
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

describe("lobby presence", () => {
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
  });

  it("counts seated humans excluding the house", async () => {
    expect(lobbyPresence()).toEqual({ seatedHumans: 0, humansInHand: 0, tableCount: 0 });

    const app = await buildApp();
    const alice = issueTestSession("xch1alice-lobby-presence");
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
    const engine = getTableEngine(tableId)!;
    expect(engine.hasPlayer(HOUSE_PLAYER_ID)).toBe(true);

    expect(lobbyPresence().seatedHumans).toBe(1);

    const res = await app.inject({ method: "GET", url: "/v1/lobby/presence" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ seatedHumans: 1, humansInHand: 0, tableCount: 1 });
  });
});
