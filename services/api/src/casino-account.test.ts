import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { creditAccount, getAccountBalance, resetAccountsForTests } from "./account-store.js";
import { authComplianceHeaders, authCompliancePayload } from "./auth-test-helpers.js";
import { resetMailOutboxForTests } from "./mail.js";
import { resetPlayerSessionsForTests } from "./player-session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCasinoRoutes } from "./routes/casino.js";
import { serializeForJson } from "./serialize.js";
import { resetUsersForTests, verifyEmailForTests } from "./user-store.js";

async function buildApp() {
  const app = Fastify();
  app.addHook("preSerialization", async (_req, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  registerAuthRoutes(app);
  registerCasinoRoutes(app);
  return app;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function registerAndLogin(app: Awaited<ReturnType<typeof buildApp>>, username: string) {
  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      username,
      password: "password1",
      email: `${username}@example.com`,
      ...authCompliancePayload(),
    },
    headers: authComplianceHeaders(),
  });
  expect(reg.statusCode).toBe(200);
  verifyEmailForTests(username);
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username, password: "password1", ...authCompliancePayload() },
    headers: authComplianceHeaders(),
  });
  expect(login.statusCode).toBe(200);
  return JSON.parse(login.body) as { token: string; playerId: string };
}

describe("casino tables use the account ledger", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_LEDGER_JOURNAL_PATH = "memory";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_CASINO_DATA_DIR = mkdtempSync(join(tmpdir(), "dat-casino-"));
    resetAccountsForTests();
    resetUsersForTests();
    resetMailOutboxForTests();
    resetPlayerSessionsForTests();
  });

  it("refuses a table without a session", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/blackjack", payload: { buyInMojos: "100000" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("debits the buy-in, blocks a second debit, and credits the stack on leave", async () => {
    const app = await buildApp();
    const { token, playerId } = await registerAndLogin(app, "casinobj");
    creditAccount(playerId, 1_000_000n);
    const headers = auth(token);

    const opened = await app.inject({
      method: "POST",
      url: "/v1/blackjack",
      headers,
      payload: { buyInMojos: "100000" },
    });
    expect(opened.statusCode).toBe(200);
    const table = JSON.parse(opened.body) as { tableId: string; stackMojos: string; accountBalanceMojos: string };
    expect(table.stackMojos).toBe("100000");
    expect(table.accountBalanceMojos).toBe("900000");
    expect(getAccountBalance(playerId)).toBe(900_000n);

    const again = await app.inject({
      method: "POST",
      url: "/v1/blackjack",
      headers,
      payload: { buyInMojos: "100000" },
    });
    const same = JSON.parse(again.body) as { tableId: string; accountBalanceMojos: string };
    expect(same.tableId).toBe(table.tableId);
    expect(getAccountBalance(playerId)).toBe(900_000n);

    const bet = await app.inject({
      method: "POST",
      url: `/v1/blackjack/${table.tableId}/bet`,
      headers,
      payload: { amountMojos: "10000" },
    });
    expect(bet.statusCode).toBe(200);
    let finished = JSON.parse(bet.body) as { phase: string; stackMojos: string };
    if (finished.phase === "acting") {
      const mid = await app.inject({ method: "POST", url: `/v1/blackjack/${table.tableId}/leave`, headers, payload: {} });
      expect(mid.statusCode).toBe(400);
      expect(getAccountBalance(playerId)).toBe(900_000n);
      const stood = await app.inject({
        method: "POST",
        url: `/v1/blackjack/${table.tableId}/action`,
        headers,
        payload: { action: "stand" },
      });
      expect(stood.statusCode).toBe(200);
      finished = JSON.parse(stood.body) as { phase: string; stackMojos: string };
    }
    expect(finished.phase).toBe("done");

    const left = await app.inject({ method: "POST", url: `/v1/blackjack/${table.tableId}/leave`, headers, payload: {} });
    expect(left.statusCode).toBe(200);
    const cash = JSON.parse(left.body) as { returnedMojos: string; accountBalanceMojos: string };
    expect(cash.returnedMojos).toBe(finished.stackMojos);
    expect(cash.accountBalanceMojos).toBe(String(900_000n + BigInt(finished.stackMojos)));
    expect(getAccountBalance(playerId)).toBe(900_000n + BigInt(finished.stackMojos));

    const gone = await app.inject({ method: "GET", url: `/v1/blackjack/${table.tableId}`, headers });
    expect(gone.statusCode).toBe(404);
    await app.close();
  });

  it("returns a video poker stack after the draw", async () => {
    const app = await buildApp();
    const { token, playerId } = await registerAndLogin(app, "casinovp");
    creditAccount(playerId, 200_000n);
    const headers = auth(token);
    const opened = await app.inject({
      method: "POST",
      url: "/v1/video-poker",
      headers,
      payload: { buyInMojos: "100000" },
    });
    const table = JSON.parse(opened.body) as { tableId: string };
    const dealt = await app.inject({
      method: "POST",
      url: `/v1/video-poker/${table.tableId}/deal`,
      headers,
      payload: { coins: 1 },
    });
    expect(dealt.statusCode).toBe(200);
    const early = await app.inject({ method: "POST", url: `/v1/video-poker/${table.tableId}/leave`, headers, payload: {} });
    expect(early.statusCode).toBe(400);
    const drawn = await app.inject({ method: "POST", url: `/v1/video-poker/${table.tableId}/draw`, headers, payload: {} });
    expect(drawn.statusCode).toBe(200);
    const view = JSON.parse(drawn.body) as { phase: string; stackMojos: string; serverSeed: string | null };
    expect(view.phase).toBe("done");
    expect(view.serverSeed).toBeTruthy();
    const left = await app.inject({ method: "POST", url: `/v1/video-poker/${table.tableId}/leave`, headers, payload: {} });
    expect(left.statusCode).toBe(200);
    expect(getAccountBalance(playerId)).toBe(100_000n + BigInt(view.stackMojos));
    await app.close();
  });

  it("rejects a buy-in the account cannot cover", async () => {
    const app = await buildApp();
    const { token, playerId } = await registerAndLogin(app, "casinobroke");
    creditAccount(playerId, 50_000n);
    const res = await app.inject({
      method: "POST",
      url: "/v1/calpoker",
      headers: auth(token),
      payload: { buyInMojos: "100000" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Insufficient/);
    expect(getAccountBalance(playerId)).toBe(50_000n);
    await app.close();
  });
});
