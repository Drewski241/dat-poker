import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { expirePasswordResetForTests, resetUsersForTests } from "./user-store.js";
import { resetPlayerSessionsForTests } from "./player-session.js";
import { resetIpRateLimitsForTests } from "./ip-rate-limit.js";
import { latestOutboxCodeForTests, resetMailOutboxForTests } from "./mail.js";
import { authComplianceHeaders, authCompliancePayload } from "./auth-test-helpers.js";

async function buildApp() {
  const app = Fastify();
  app.addHook("preSerialization", async (_req, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  registerAuthRoutes(app);
  return app;
}

async function verifyNewAccount(
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  email: string,
) {
  const code = latestOutboxCodeForTests(email, "Verify");
  expect(code).toBeTruthy();
  const verified = await app.inject({
    method: "POST",
    url: "/v1/auth/email/verify",
    payload: { username, code, ...authCompliancePayload() },
    headers: authComplianceHeaders(),
  });
  expect(verified.statusCode).toBe(200);
  return JSON.parse(verified.body) as { token: string; playerId: string };
}

describe("player accounts", () => {
  beforeEach(() => {
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_EMAIL_MODE = "memory";
    process.env.DAT_PLAY_COMPLIANCE_MODE = "test";
    process.env.DAT_BLOCKED_COUNTRY_CODES = "CU,IR";
    resetUsersForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
    resetMailOutboxForTests();
  });

  it("registers with required email, verifies, signs in, and rejects duplicate username", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: "Alice_1",
        password: "hunter2xx",
        email: "alice@example.com",
        ...authCompliancePayload(),
      },
      headers: authComplianceHeaders(),
    });
    expect(created.statusCode).toBe(200);
    const body = JSON.parse(created.body);
    expect(body.username).toBe("Alice_1");
    expect(body.needsEmailVerification).toBe(true);
    expect(body.token).toBeUndefined();
    expect(body.emailVerified).toBe(false);

    const unverifiedLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "Alice_1", password: "hunter2xx", ...authCompliancePayload() },
      headers: authComplianceHeaders(),
    });
    expect(unverifiedLogin.statusCode).toBe(400);

    const verified = await verifyNewAccount(app, "Alice_1", "alice@example.com");
    expect(verified.playerId).toMatch(/^user_/);
    expect(verified.token).toBeTruthy();

    const dup = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: "alice_1",
        password: "otherpass12",
        email: "other@example.com",
        ...authCompliancePayload(),
      },
      headers: authComplianceHeaders(),
    });
    expect(dup.statusCode).toBe(400);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${verified.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).username).toBe("Alice_1");
    expect(JSON.parse(me.body).emailVerified).toBe(true);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "Alice_1", password: "hunter2xx", ...authCompliancePayload() },
      headers: authComplianceHeaders(),
    });
    expect(login.statusCode).toBe(200);

    const bad = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "Alice_1", password: "wrong-password", ...authCompliancePayload() },
      headers: authComplianceHeaders(),
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("blocks sign-in when jurisdiction or bot checks fail", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: "legaluser",
        password: "password1",
        email: "legal@example.com",
        ...authCompliancePayload("US"),
      },
      headers: authComplianceHeaders("US"),
    });
    await verifyNewAccount(app, "legaluser", "legal@example.com");

    const blockedCountry = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: "legaluser",
        password: "password1",
        ...authCompliancePayload("CU"),
      },
      headers: authComplianceHeaders("US"),
    });
    expect(blockedCountry.statusCode).toBe(403);

    const noBot = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: "legaluser",
        password: "password1",
        countryCode: "US",
        ageConfirmed: true,
      },
      headers: authComplianceHeaders("US"),
    });
    expect(noBot.statusCode).toBe(403);
    await app.close();
  });

  it("rejects registration without email and rejects weak credentials", async () => {
    const app = await buildApp();
    const noEmail = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "validname", password: "password1", ...authCompliancePayload() },
      headers: authComplianceHeaders(),
    });
    expect(noEmail.statusCode).toBe(400);
    const shortName = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: "ab",
        password: "password1",
        email: "a@b.com",
        ...authCompliancePayload(),
      },
      headers: authComplianceHeaders(),
    });
    expect(shortName.statusCode).toBe(400);
    const shortPass = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: "validname",
        password: "short",
        email: "a@b.com",
        ...authCompliancePayload(),
      },
      headers: authComplianceHeaders(),
    });
    expect(shortPass.statusCode).toBe(400);
    await app.close();
  });

  it("emails a password reset code after the account email is verified", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: "resetme",
        password: "oldpass12",
        email: "reset.me@example.com",
        ...authCompliancePayload(),
      },
      headers: authComplianceHeaders(),
    });
    await verifyNewAccount(app, "resetme", "reset.me@example.com");

    const missed = await app.inject({
      method: "POST",
      url: "/v1/auth/password/forgot",
      payload: { username: "resetme", email: "wrong@example.com" },
    });
    expect(missed.statusCode).toBe(200);
    expect(JSON.parse(missed.body).resetCode).toBeUndefined();

    const forgot = await app.inject({
      method: "POST",
      url: "/v1/auth/password/forgot",
      payload: { username: "resetme", email: "reset.me@example.com" },
    });
    expect(forgot.statusCode).toBe(200);
    expect(JSON.parse(forgot.body).resetCode).toBeUndefined();
    const code = latestOutboxCodeForTests("reset.me@example.com", "Reset");
    expect(code).toMatch(/^[0-9a-f]{8}$/);

    const badCode = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { username: "resetme", resetCode: "deadbeef", password: "newpass99" },
    });
    expect(badCode.statusCode).toBe(400);

    const reset = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { username: "resetme", resetCode: code, password: "newpass99" },
    });
    expect(reset.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "resetme", password: "oldpass12", ...authCompliancePayload() },
      headers: authComplianceHeaders(),
    });
    expect(oldLogin.statusCode).toBe(400);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "resetme", password: "newpass99", ...authCompliancePayload() },
      headers: authComplianceHeaders(),
    });
    expect(login.statusCode).toBe(200);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { username: "resetme", resetCode: code, password: "thirdpass" },
    });
    expect(replay.statusCode).toBe(400);
    await app.close();
  });

  it("rejects an expired reset code and a signed-in change with the wrong current password", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: "changer",
        password: "keepme123",
        email: "changer@example.com",
        ...authCompliancePayload(),
      },
      headers: authComplianceHeaders(),
    });
    const created = await verifyNewAccount(app, "changer", "changer@example.com");

    await app.inject({
      method: "POST",
      url: "/v1/auth/password/forgot",
      payload: { username: "changer", email: "changer@example.com" },
    });
    const resetCode = latestOutboxCodeForTests("changer@example.com", "Reset") as string;
    expirePasswordResetForTests("changer");
    const expired = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { username: "changer", resetCode, password: "latepass1" },
    });
    expect(expired.statusCode).toBe(400);

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/password/change",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { currentPassword: "nope1234", password: "freshpass" },
    });
    expect(wrong.statusCode).toBe(400);

    const changed = await app.inject({
      method: "POST",
      url: "/v1/auth/password/change",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { currentPassword: "keepme123", password: "freshpass" },
    });
    expect(changed.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "changer", password: "freshpass", ...authCompliancePayload() },
      headers: authComplianceHeaders(),
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });
});
