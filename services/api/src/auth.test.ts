import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { registerAuthRoutes } from "./routes/auth.js";
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

describe("player accounts", () => {
  beforeEach(() => {
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    resetUsersForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
  });

  it("registers, signs in, and rejects a duplicate username", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "Alice_1", password: "hunter2xx", email: "alice@example.com" },
    });
    expect(created.statusCode).toBe(200);
    const body = JSON.parse(created.body);
    expect(body.username).toBe("Alice_1");
    expect(body.playerId).toMatch(/^user_/);
    expect(body.token).toBeTruthy();
    expect(body.sageLinked).toBe(false);

    const dup = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "alice_1", password: "otherpass" },
    });
    expect(dup.statusCode).toBe(400);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).username).toBe("Alice_1");

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

  it("rejects a short username and a short password", async () => {
    const app = await buildApp();
    const shortName = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "ab", password: "password1" },
    });
    expect(shortName.statusCode).toBe(400);
    const shortPass = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "validname", password: "short" },
    });
    expect(shortPass.statusCode).toBe(400);
    await app.close();
  });

  it("resets a forgotten password with username, email, and a one-time code", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "resetme", password: "oldpass12", email: "Reset.Me@example.com" },
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
      payload: { username: "resetme", password: "oldpass12" },
    });
    expect(oldLogin.statusCode).toBe(400);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "resetme", password: "newpass99" },
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
    const created = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { username: "changer", password: "keepme123", email: "changer@example.com" },
        })
      ).body,
    );

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
      payload: { username: "changer", password: "freshpass" },
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });
});
