import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { resetUsersForTests, verifyEmailForTests } from "./user-store.js";
import { resetMailOutboxForTests } from "./mail.js";
import { resetPlayerSessionsForTests } from "./player-session.js";
import { resetIpRateLimitsForTests } from "./ip-rate-limit.js";
import { resetAccountsForTests, tryRedeemDaily, getAccountBalance } from "./account-store.js";
import {
  resetPlayerActivityForTests,
  setPlayerActivityForTests,
} from "./player-activity.js";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";

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
  registerWalletRoutes(app, chia);
  registerTableRoutes(app);
  registerHandRoutes(app);
  return app;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function registerAndLogin(
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  password: string,
) {
  const email = `${username}@example.com`;
  await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { username, password, email },
  });
  verifyEmailForTests(username);
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username, password },
  });
  return JSON.parse(login.body) as { token: string; playerId: string };
}

describe("inactive player unseat", () => {
  beforeEach(() => {
    process.env.DAT_PLAYER_INACTIVE_UNSEAT_MS = "10000";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_EMAIL_MODE = "memory";
    resetTablesForTests();
    resetAccountsForTests();
    resetUsersForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
    resetMailOutboxForTests();
    resetPlayerActivityForTests();
  });

  it("unseats an inactive human and returns their stack to the account ledger", async () => {
    const app = await buildApp();
    const alice = await registerAndLogin(app, "alice", "password1");
    const bob = await registerAndLogin(app, "bob", "password1");
    tryRedeemDaily(alice.playerId, 5_000_000n);
    tryRedeemDaily(bob.playerId, 5_000_000n);

    const joinAlice = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tables/join",
          headers: auth(alice.token),
          payload: { playerId: alice.playerId, buyInMojos: "1000000", devAck: true },
        })
      ).body,
    );
    const tableId = joinAlice.tableId as string;

    await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(bob.token),
      payload: { playerId: bob.playerId, buyInMojos: "1000000", devAck: true },
    });

    const staleAt = Date.now() - 15_000;
    setPlayerActivityForTests(bob.playerId, staleAt);

    const refreshed = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/tables/${tableId}`,
          headers: auth(alice.token),
        })
      ).body,
    );
    expect(refreshed.unseatedInactive).toEqual([
      expect.objectContaining({ playerId: bob.playerId, stackMojos: "1000000" }),
    ]);
    expect(refreshed.seats.some((s: { playerId: string }) => s.playerId === bob.playerId)).toBe(
      false,
    );
    expect(getAccountBalance(bob.playerId)).toBe(5_000_000n);
    await app.close();
  });

  it("does not unseat inactive players while a hand is in progress", async () => {
    const app = await buildApp();
    const alice = await registerAndLogin(app, "alice2", "password1");
    const bob = await registerAndLogin(app, "bob2", "password1");
    tryRedeemDaily(alice.playerId, 5_000_000n);
    tryRedeemDaily(bob.playerId, 5_000_000n);

    const joinAlice = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tables/join",
          headers: auth(alice.token),
          payload: { playerId: alice.playerId, buyInMojos: "1000000", devAck: true },
        })
      ).body,
    );
    const tableId = joinAlice.tableId as string;
    await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(bob.token),
      payload: { playerId: bob.playerId, buyInMojos: "1000000", devAck: true },
    });

    await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/go`,
      headers: auth(alice.token),
      payload: { playerId: alice.playerId },
    });

    setPlayerActivityForTests(bob.playerId, Date.now() - 15_000);
    const midHand = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/tables/${tableId}`,
          headers: auth(alice.token),
        })
      ).body,
    );
    expect(midHand.handInProgress).toBe(true);
    expect(midHand.seats.some((s: { playerId: string }) => s.playerId === bob.playerId)).toBe(true);
    await app.close();
  });
});
