import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import {
  creditAccount,
  getAccountBalance,
  getPlaythrough,
  resetAccountsForTests,
  setPlaythroughHands,
  applyBuyInPlaythrough,
} from "./account-store.js";
import { registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { resetUsersForTests } from "./user-store.js";
import { resetMailOutboxForTests } from "./mail.js";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { issueTestSession, resetPlayerSessionsForTests } from "./player-session.js";
import { resetIpRateLimitsForTests } from "./ip-rate-limit.js";
import { getPendingWithdrawOffer, resetWithdrawalsForTests } from "./withdraw-store.js";

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

describe("account withdraw + treasury offer", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_WITHDRAWALS_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_EMAIL_MODE = "memory";
    process.env.DAT_PLAY_COMPLIANCE_MODE = "test";
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
    process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID = "a".repeat(64);
    process.env.DAT_TREASURY_PAYOUT_URL = "http://127.0.0.1:9/payout";
    resetMailOutboxForTests();
    resetTablesForTests();
    resetAccountsForTests();
    resetWithdrawalsForTests();
    resetPlayerSessionsForTests();
    resetUsersForTests();
    resetIpRateLimitsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    delete process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID;
  });

  it("does not burn unlocked DAT when treasury payout fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("treasury down", { status: 503 })),
    );
    const app = await buildApp();
    const alice = issueTestSession("xch1withdraw-fail");
    creditAccount(alice.session.playerId, 500_000n);
    applyBuyInPlaythrough(alice.session.playerId, 500_000n, false);
    setPlaythroughHands(alice.session.playerId, 500);

    const beforePt = getPlaythrough(alice.session.playerId);
    const beforeBal = getAccountBalance(alice.session.playerId);

    const withdrawn = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, fromAccount: true, devAck: true },
    });
    expect(withdrawn.statusCode).toBe(502);
    expect(JSON.parse(withdrawn.body).error).toMatch(/not withdrawn/i);
    expect(getPlaythrough(alice.session.playerId)).toEqual(beforePt);
    expect(getAccountBalance(alice.session.playerId)).toBe(beforeBal);
    expect(getPendingWithdrawOffer(alice.session.playerId)).toBeUndefined();
    await app.close();
  });

  it("debits only after a treasury offer is returned and keeps the offer pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ offer: "offer1qqqtest" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const app = await buildApp();
    const alice = issueTestSession("xch1withdraw-ok");
    creditAccount(alice.session.playerId, 500_000n);
    applyBuyInPlaythrough(alice.session.playerId, 500_000n, false);
    setPlaythroughHands(alice.session.playerId, 500);

    const withdrawn = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, fromAccount: true, devAck: true },
    });
    expect(withdrawn.statusCode).toBe(200);
    const body = JSON.parse(withdrawn.body) as {
      mode: string;
      offer?: string;
      stackMojos: string;
      accountMojos: string;
    };
    expect(body.mode).toBe("offer");
    expect(body.offer).toBe("offer1qqqtest");
    expect(body.stackMojos).toBe("500000");
    expect(body.accountMojos).toBe("0");
    expect(getPendingWithdrawOffer(alice.session.playerId)?.offer).toBe("offer1qqqtest");

    const pending = await app.inject({
      method: "GET",
      url: "/v1/wallet/withdraw/pending",
      headers: auth(alice.token),
    });
    expect(pending.statusCode).toBe(200);
    expect(JSON.parse(pending.body).pending.offer).toBe("offer1qqqtest");
    await app.close();
  });
});
