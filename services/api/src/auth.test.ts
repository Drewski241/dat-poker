import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { resetEmailOutboxForTests } from "./email-mailer.js";
import { expirePasswordResetForTests, resetUsersForTests } from "./user-store.js";
import { resetPlayerSessionsForTests } from "./player-session.js";
import { resetIpRateLimitsForTests } from "./ip-rate-limit.js";

async function buildApp() {
  const app = Fastify();
  app.addHook("preSerialization", async (_req, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  registerAuthRoutes(app);
  return app;
}

async function registerAndVerify(
  app: Awaited<ReturnType<typeof buildApp>>,
  payload: { username: string; password: string; email: string },
) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload,
  });
  expect(created.statusCode).toBe(200);
  const body = JSON.parse(created.body);
  expect(body.token).toBeUndefined();
  expect(body.verificationToken).toBeTruthy();
  const verified = await app.inject({
    method: "POST",
    url: "/v1/auth/email/verify",
    payload: { token: body.verificationToken },
  });
  expect(verified.statusCode).toBe(200);
  return JSON.parse(verified.body) as { token: string; username: string; playerId: string };
}

describe("player accounts", () => {
  beforeEach(() => {
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_EMAIL_DEV = "true";
    resetUsersForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
    resetEmailOutboxForTests();
  });

  it("registers, verifies email, signs in, and rejects a duplicate username", async () => {
    const app = await buildApp();
    const verified = await registerAndVerify(app, {
      username: "Alice_1",
      password: "hunter2xx",
      email: "alice@example.com",
    });
    expect(verified.username).toBe("Alice_1");
    expect(verified.playerId).toMatch(/^user_/);
    expect(verified.token).toBeTruthy();

    const dup = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "alice_1", password: "otherpass", email: "other@example.com" },
    });
    expect(dup.statusCode).toBe(400);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${verified.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).emailVerified).toBe(true);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "Alice_1", password: "hunter2xx" },
    });
    expect(login.statusCode).toBe(200);

    const bad = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "Alice_1", password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("blocks sign-in until email is verified", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "unverified", password: "password1", email: "u@example.com" },
    });
    expect(created.statusCode).toBe(200);
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "unverified", password: "password1" },
    });
    expect(blocked.statusCode).toBe(400);
    expect(JSON.parse(blocked.body).error).toMatch(/verify your email/i);
    await app.close();
  });

  it("rejects a short username, short password, and missing email", async () => {
    const app = await buildApp();
    const shortName = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "ab", password: "password1", email: "a@example.com" },
    });
    expect(shortName.statusCode).toBe(400);
    const shortPass = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "validname", password: "short", email: "a@example.com" },
    });
    expect(shortPass.statusCode).toBe(400);
    const noEmail = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "validname", password: "password1", email: "" },
    });
    expect(noEmail.statusCode).toBe(400);
    await app.close();
  });

  it("resets a forgotten password via emailed code (dev exposes code for tests)", async () => {
    const app = await buildApp();
    await registerAndVerify(app, {
      username: "resetme",
      password: "oldpass12",
      email: "Reset.Me@example.com",
    });

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
    const code = JSON.parse(forgot.body).resetCode as string;
    expect(code).toMatch(/^[0-9a-f]{8}$/);

    const reset = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { username: "resetme", resetCode: code, password: "newpass99" },
    });
    expect(reset.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "resetme", password: "newpass99" },
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });

  it("rejects an expired reset code and a signed-in change with the wrong current password", async () => {
    const app = await buildApp();
    const verified = await registerAndVerify(app, {
      username: "changer",
      password: "keepme123",
      email: "changer@example.com",
    });

    const forgot = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/password/forgot",
          payload: { username: "changer", email: "changer@example.com" },
        })
      ).body,
    );
    expirePasswordResetForTests("changer");
    const expired = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { username: "changer", resetCode: forgot.resetCode, password: "latepass1" },
    });
    expect(expired.statusCode).toBe(400);

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/password/change",
      headers: { authorization: `Bearer ${verified.token}` },
      payload: { currentPassword: "nope1234", password: "freshpass" },
    });
    expect(wrong.statusCode).toBe(400);

    const changed = await app.inject({
      method: "POST",
      url: "/v1/auth/password/change",
      headers: { authorization: `Bearer ${verified.token}` },
      payload: { currentPassword: "keepme123", password: "freshpass" },
    });
    expect(changed.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "changer", password: "freshpass" },
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });
});
