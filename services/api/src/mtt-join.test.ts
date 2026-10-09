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
        maxHumans?: number;
      };
    };
    expect(body.format).toBe("mtt");
    expect(body.maxSeats).toBe(8);
    expect(body.sng.kind).toBe("mtt");
    expect(body.sng.tableLabel).toBe("Table 1");
    expect(body.sng.fieldSize).toBe(16);
    expect(body.sng.eventPlayersRemaining).toBe(16);
    expect(body.sng.isFinalTable).toBe(false);
    expect(body.sng.maxHumans).toBe(10);
    const event = getMtt(body.tableId);
    expect(event?.tableIds()).toHaveLength(2);
    expect(event?.engines().every((eng) => eng.getActivePlayerCount() === 8)).toBe(true);
    await app.close();
  });

  it("opens a new 16-player SNG when an event is at the human cap", async () => {
    process.env.DAT_MTT_MAX_HUMANS = "1";
    const app = await buildApp();
    const alice = issueTestSession("xch1cap-a");
    const bob = issueTestSession("xch1cap-b");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    tryRedeemDaily(bob.session.playerId, 5_000_000n);

    const first = await app.inject({
      method: "POST",
      url: "/v1/tables/join-mtt",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body) as { tableId: string; sng: { eventId: string } };
    const firstEvent = getMtt(firstBody.tableId)!;
    expect(firstEvent.enteredHumanCount()).toBe(1);
    expect(firstEvent.maxHumans).toBe(1);

    const second = await app.inject({
      method: "POST",
      url: "/v1/tables/join-mtt",
      headers: auth(bob.token),
      payload: { playerId: bob.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = JSON.parse(second.body) as { tableId: string; sng: { eventId: string } };
    expect(secondBody.sng.eventId).not.toBe(firstBody.sng.eventId);
    expect(getMtt(secondBody.tableId)?.enteredHumanCount()).toBe(1);
    await app.close();
  });

  it("keeps 16-player sit-n-go separate from the large MTT on beta", async () => {
    process.env.DAT_POKER_STAGE = "beta";
    delete process.env.DAT_MTT_FIELD_SIZE;
    const app = await buildApp();
    const alice = issueTestSession("xch1mtt500");
    const bob = issueTestSession("xch1mtt16");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    tryRedeemDaily(bob.session.playerId, 5_000_000n);

    const large = await app.inject({
      method: "POST",
      url: "/v1/tables/join-mtt",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(large.statusCode).toBe(200);
    const largeBody = JSON.parse(large.body) as { sng: { fieldSize: number; eventId: string } };
    expect(largeBody.sng.fieldSize).toBe(500);

    const sit = await app.inject({
      method: "POST",
      url: "/v1/tables/join-mtt",
      headers: auth(bob.token),
      payload: {
        playerId: bob.session.playerId,
        buyInMojos: "1000000",
        devAck: true,
        fieldSize: 16,
      },
    });
    expect(sit.statusCode).toBe(200);
    const sitBody = JSON.parse(sit.body) as { sng: { fieldSize: number; eventId: string } };
    expect(sitBody.sng.fieldSize).toBe(16);
    expect(sitBody.sng.eventId).not.toBe(largeBody.sng.eventId);
    await app.close();
  });
});
