import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { creditAccount, getAccountBalance, resetAccountsForTests } from "./account-store.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerPlayRoutes } from "./routes/play.js";
import { registerSlotsRoutes } from "./routes/slots.js";
import { resetUsersForTests, verifyEmailForTests } from "./user-store.js";
import { resetMailOutboxForTests } from "./mail.js";
import { resetPlayerSessionsForTests } from "./player-session.js";
import { resetIpRateLimitsForTests } from "./ip-rate-limit.js";
import { authComplianceHeaders, authCompliancePayload } from "./auth-test-helpers.js";
import { resetJackpotForTests } from "./jackpot-store.js";

async function buildApp() {
  const app = Fastify();
  app.addHook("preSerialization", async (_req, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  registerAuthRoutes(app);
  registerSessionRoutes(app);
  registerPlayRoutes(app);
  registerSlotsRoutes(app);
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

describe("Spirit Slots account balance", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_JOURNAL_PATH = "memory";
    resetAccountsForTests();
    resetUsersForTests();
    resetMailOutboxForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
    resetJackpotForTests();
  });

  it("spins using table account DAT without a separate play redeem", async () => {
    const app = await buildApp();
    const created = await registerAndLogin(app, "slotplayer");
    creditAccount(created.playerId, 50_000n); // 50 DAT

    const session = await app.inject({
      method: "GET",
      url: `/v1/play/session?playerId=${encodeURIComponent(created.playerId)}`,
    });
    expect(session.statusCode).toBe(200);
    const sessionBody = JSON.parse(session.body) as { active: boolean; stackMojos: string };
    expect(sessionBody.active).toBe(true);
    expect(sessionBody.stackMojos).toBe("50000");

    const spin = await app.inject({
      method: "POST",
      url: "/v1/slots/spin",
      headers: auth(created.token),
      payload: { playerId: created.playerId, betMojos: "5000" },
    });
    expect(spin.statusCode).toBe(200);
    const spinBody = JSON.parse(spin.body) as { betMojos: string; accountBalanceMojos: string };
    expect(spinBody.betMojos).toBe("5000");
    expect(getAccountBalance(created.playerId)).toBe(BigInt(spinBody.accountBalanceMojos));
    await app.close();
  });

  it("rejects bets outside the allowed 1–20 DAT menu", async () => {
    const app = await buildApp();
    const created = await registerAndLogin(app, "badbet");
    creditAccount(created.playerId, 100_000n);
    const spin = await app.inject({
      method: "POST",
      url: "/v1/slots/spin",
      headers: auth(created.token),
      payload: { playerId: created.playerId, betMojos: "3000" },
    });
    expect(spin.statusCode).toBe(400);
    await app.close();
  });
});
