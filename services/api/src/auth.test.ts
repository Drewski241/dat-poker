import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { resetUsersForTests } from "./user-store.js";
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
});
