import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests, tryRedeemDaily } from "./account-store.js";
import { getSng, registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
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

describe("9-max SNG blind clock", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_EMAIL_MODE = "memory";
    process.env.DAT_PLAY_COMPLIANCE_MODE = "test";
    process.env.DAT_TERMS_ACCEPTANCE_PATH = "memory";
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
    process.env.DAT_DAILY_REDEEM_MOJOS = "5000000";
    resetMailOutboxForTests();
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
    resetUsersForTests();
    resetIpRateLimitsForTests();
  });

  it("starts at 10/20 and applies the next level after the clock elapses between hands", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1sngclock");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);

    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-sng",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body) as {
      tableId: string;
      format: string;
      smallBlindMojos: string;
      bigBlindMojos: string;
      sng: {
        status: string;
        levelIndex: number;
        smallBlindMojos: string;
        bigBlindMojos: string;
        nextSmallBlindMojos: string;
        nextBigBlindMojos: string;
        levelDurationMs: number;
        startedAtMs: number;
        nextLevelAtMs: number;
      };
    };
    expect(body.format).toBe("sng");
    expect(body.sng.status).toBe("running");
    expect(body.smallBlindMojos).toBe("10000");
    expect(body.bigBlindMojos).toBe("20000");
    expect(body.sng.levelIndex).toBe(0);
    expect(body.sng.smallBlindMojos).toBe("10000");
    expect(body.sng.nextSmallBlindMojos).toBe("15000");
    expect(body.sng.nextBigBlindMojos).toBe("30000");
    expect(body.sng.levelDurationMs).toBe(180_000);
    expect(body.sng.nextLevelAtMs).toBe(body.sng.startedAtMs + 180_000);

    const sng = getSng(body.tableId);
    expect(sng).toBeDefined();
    sng!.syncBlindClock(body.sng.startedAtMs + 180_000);

    const poll = await app.inject({
      method: "GET",
      url: `/v1/tables/${body.tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });
    expect(poll.statusCode).toBe(200);
    const after = JSON.parse(poll.body) as {
      smallBlindMojos: string;
      bigBlindMojos: string;
      sng: { levelIndex: number; smallBlindMojos: string; bigBlindMojos: string };
    };
    expect(after.smallBlindMojos).toBe("15000");
    expect(after.bigBlindMojos).toBe("30000");
    expect(after.sng.levelIndex).toBe(1);
    expect(after.sng.smallBlindMojos).toBe("15000");
    await app.close();
  });
});
