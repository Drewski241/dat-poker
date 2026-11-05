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
import {
  contributeToJackpot,
  readProgressiveJackpotMojos,
  resetJackpotForTests,
} from "./jackpot-store.js";
import { resetSlotPlayerStateForTests } from "./slot-player-state.js";

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
    process.env.DAT_SLOTS_JACKPOT_PATH = "memory";
    process.env.DAT_SLOT_PLAYER_STATE_PATH = "memory";
    process.env.DAT_VAULT_BONUS = "never";
    resetSlotPlayerStateForTests();
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

  it("lists five slot games with separate progressives", async () => {
    resetJackpotForTests();
    const app = await buildApp();
    const spiritBefore = readProgressiveJackpotMojos("spirit");
    contributeToJackpot("mine-mojo", 20_000n, 500);
    expect(readProgressiveJackpotMojos("mine-mojo")).toBe(101_000n);
    expect(readProgressiveJackpotMojos("spirit")).toBe(spiritBefore);
    const catalog = await app.inject({ method: "GET", url: "/v1/slots/catalog" });
    expect(catalog.statusCode).toBe(200);
    const body = JSON.parse(catalog.body) as { games: { id: string }[] };
    expect(body.games.map((g) => g.id).sort()).toEqual([
      "house-edge",
      "mine-mojo",
      "poker-hands",
      "spirit",
      "spirit-stampede",
    ]);
    await app.close();
  });

  it("spins mine-mojo via game route", async () => {
    const app = await buildApp();
    const created = await registerAndLogin(app, "miner");
    creditAccount(created.playerId, 50_000n);
    const spin = await app.inject({
      method: "POST",
      url: "/v1/slots/mine-mojo/spin",
      headers: auth(created.token),
      payload: { playerId: created.playerId, betMojos: "1000" },
    });
    expect(spin.statusCode).toBe(200);
    const spinBody = JSON.parse(spin.body) as { gameId: string; result: { meta?: { cascadeSteps?: number } } };
    expect(spinBody.gameId).toBe("mine-mojo");
    await app.close();
  });

  it("credits Spirit Stampede ways wins in whole mojos", async () => {
    const app = await buildApp();
    const created = await registerAndLogin(app, "stampede");
    creditAccount(created.playerId, 80_000n);
    let sawLineWin = false;
    for (let i = 0; i < 40; i++) {
      const spin = await app.inject({
        method: "POST",
        url: "/v1/slots/spirit-stampede/spin",
        headers: auth(created.token),
        payload: { playerId: created.playerId, betMojos: "1000" },
      });
      expect(spin.statusCode, spin.body).toBe(200);
      const body = JSON.parse(spin.body) as {
        lineWinMojos: string;
        accountBalanceMojos: string;
        error?: string;
      };
      expect(body.error).toBeUndefined();
      expect(() => BigInt(body.lineWinMojos)).not.toThrow();
      expect(getAccountBalance(created.playerId)).toBe(BigInt(body.accountBalanceMojos));
      if (BigInt(body.lineWinMojos) > 0n) sawLineWin = true;
    }
    expect(sawLineWin).toBe(true);
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

describe("Crack the Vault bonus", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_JOURNAL_PATH = "memory";
    process.env.DAT_SLOTS_JACKPOT_PATH = "memory";
    process.env.DAT_SLOT_PLAYER_STATE_PATH = "memory";
    process.env.DAT_VAULT_BONUS = "always";
    resetAccountsForTests();
    resetUsersForTests();
    resetMailOutboxForTests();
    resetPlayerSessionsForTests();
    resetIpRateLimitsForTests();
    resetJackpotForTests();
    resetSlotPlayerStateForTests();
  });

  it("opens on a paid spin, pays flipped chips once, then lets the next spin through", async () => {
    const app = await buildApp();
    const created = await registerAndLogin(app, "vaultplayer");
    creditAccount(created.playerId, 50_000n);
    const before = getAccountBalance(created.playerId);

    const spin = await app.inject({
      method: "POST",
      url: "/v1/slots/mine-mojo/spin",
      headers: auth(created.token),
      payload: { playerId: created.playerId, betMojos: "1000" },
    });
    expect(spin.statusCode, spin.body).toBe(200);
    const spun = JSON.parse(spin.body) as {
      vaultBonus?: { bonusId: string; cards: { revealed: boolean }[]; collectedMojos: string };
      accountBalanceMojos: string;
    };
    expect(spun.vaultBonus?.cards).toHaveLength(5);
    expect(spun.vaultBonus?.cards.every((card) => card.revealed === false)).toBe(true);
    expect(spun.vaultBonus?.collectedMojos).toBe("0");
    const afterSpin = BigInt(spun.accountBalanceMojos);
    expect(afterSpin).toBe(getAccountBalance(created.playerId));
    expect(before).toBeGreaterThan(0n);

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/slots/spin",
      headers: auth(created.token),
      payload: { playerId: created.playerId, betMojos: "1000" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(getAccountBalance(created.playerId)).toBe(afterSpin);

    let finished = false;
    let collected = 0n;
    for (let index = 0; index < 5 && !finished; index += 1) {
      const flip = await app.inject({
        method: "POST",
        url: "/v1/slots/bonus/flip",
        headers: auth(created.token),
        payload: { index },
      });
      expect(flip.statusCode, flip.body).toBe(200);
      const body = JSON.parse(flip.body) as { finished: boolean; collectedMojos: string };
      finished = body.finished;
      collected = BigInt(body.collectedMojos);
    }
    expect(finished).toBe(true);
    expect(getAccountBalance(created.playerId)).toBe(afterSpin + collected);

    const again = await app.inject({
      method: "GET",
      url: "/v1/slots/bonus",
      headers: auth(created.token),
    });
    expect(JSON.parse(again.body)).toEqual({ bonus: null });

    const next = await app.inject({
      method: "POST",
      url: "/v1/slots/spirit/spin",
      headers: auth(created.token),
      payload: { playerId: created.playerId, betMojos: "1000" },
    });
    expect(next.statusCode, next.body).toBe(200);
    await app.close();
  });

  it("cashes out the chips already flipped and leaves the rake unturned", async () => {
    const app = await buildApp();
    const created = await registerAndLogin(app, "vaultcash");
    creditAccount(created.playerId, 20_000n);
    const spin = await app.inject({
      method: "POST",
      url: "/v1/slots/spin",
      headers: auth(created.token),
      payload: { playerId: created.playerId, betMojos: "2000" },
    });
    expect(spin.statusCode, spin.body).toBe(200);
    const afterSpin = BigInt(
      (JSON.parse(spin.body) as { accountBalanceMojos: string }).accountBalanceMojos,
    );

    const early = await app.inject({
      method: "POST",
      url: "/v1/slots/bonus/cash-out",
      headers: auth(created.token),
      payload: {},
    });
    expect(early.statusCode).toBe(400);

    let settled = false;
    for (let index = 0; index < 5 && !settled; index += 1) {
      const flip = await app.inject({
        method: "POST",
        url: "/v1/slots/bonus/flip",
        headers: auth(created.token),
        payload: { index },
      });
      const body = JSON.parse(flip.body) as {
        finished: boolean;
        hitRake: boolean;
        reveal?: { kind: string; payoutMojos?: string };
        collectedMojos: string;
      };
      if (body.finished) {
        expect(body.hitRake).toBe(true);
        expect(getAccountBalance(created.playerId)).toBe(afterSpin + BigInt(body.collectedMojos));
        settled = true;
        break;
      }
      const cash = await app.inject({
        method: "POST",
        url: "/v1/slots/bonus/cash-out",
        headers: auth(created.token),
        payload: {},
      });
      expect(cash.statusCode, cash.body).toBe(200);
      const paid = JSON.parse(cash.body) as { collectedMojos: string };
      expect(paid.collectedMojos).toBe(body.reveal?.payoutMojos);
      expect(getAccountBalance(created.playerId)).toBe(afterSpin + BigInt(paid.collectedMojos));
      settled = true;
    }
    expect(settled).toBe(true);
    await app.close();
  });
});
