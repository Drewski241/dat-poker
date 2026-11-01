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

describe("PLO joins", () => {
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

  it("joins 6-max PLO cash", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1plo-cash");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(alice.token),
      payload: {
        playerId: alice.session.playerId,
        buyInMojos: "1000000",
        devAck: true,
        variant: "plo4",
      },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body);
    expect(body.variant).toBe("plo4");
    expect(body.format).toBe("cash");
    await app.close();
  });

  it("joins 8-max PLO SNG", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1plo-sng8");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-sng-plo8",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body);
    expect(body.variant).toBe("plo4");
    expect(body.maxSeats).toBe(8);
    expect(body.sng.variant).toBe("plo4");
    await app.close();
  });

  it("joins 16-player PLO SNG as two 8-max tables", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1plo-mtt16");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-mtt-plo16",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body);
    expect(body.variant).toBe("plo4");
    expect(body.maxSeats).toBe(8);
    expect(body.sng.fieldSize).toBe(16);
    expect(body.sng.variant).toBe("plo4");
    const mtt = getMtt(body.tableId)!;
    expect(mtt.startingTableCount).toBe(2);
    expect(mtt.startingTableSeats).toBe(8);
    expect(mtt.finalTableSeats).toBe(8);
    await app.close();
  });

  it("joins PLO 500 MTT with 8-max tables", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1plo-mtt500");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-mtt-plo500",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body);
    expect(body.variant).toBe("plo4");
    expect(body.maxSeats).toBe(8);
    expect(body.sng.fieldSize).toBe(500);
    const mtt = getMtt(body.tableId)!;
    expect(mtt.startingTableSeats).toBe(8);
    expect(mtt.variant).toBe("plo4");
    await app.close();
  });
});
