import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests, tryRedeemDaily } from "./account-store.js";
import { getMtt, registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { resetUsersForTests } from "./user-store.js";
import { resetMailOutboxForTests } from "./mail.js";
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

describe("16-player MTT join", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_EMAIL_MODE = "memory";
    process.env.DAT_PLAY_COMPLIANCE_MODE = "test";
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_SNG_FILL_HOUSE = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
    resetMailOutboxForTests();
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
    resetUsersForTests();
    resetIpRateLimitsForTests();
  });

  it("opens two 8-max tables and reports the event on join", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1mtt");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-mtt",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body) as {
      tableId: string;
      format: string;
      maxSeats: number;
      sng: {
        kind: string;
        tableLabel: string;
        fieldSize: number;
        eventPlayersRemaining: number;
        isFinalTable: boolean;
      };
    };
    expect(body.format).toBe("mtt");
    expect(body.maxSeats).toBe(8);
    expect(body.sng.kind).toBe("mtt");
    expect(body.sng.tableLabel).toBe("Table 1");
    expect(body.sng.fieldSize).toBe(16);
    expect(body.sng.eventPlayersRemaining).toBe(16);
    expect(body.sng.isFinalTable).toBe(false);
    const event = getMtt(body.tableId);
    expect(event?.tableIds()).toHaveLength(2);
    expect(event?.engines().every((eng) => eng.getActivePlayerCount() === 8)).toBe(true);
    await app.close();
  });
});
