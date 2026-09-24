import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import {
  creditAccount,
  getAccountBalance,
  getPlaythrough,
  resetAccountsForTests,
  tryRedeemDaily,
} from "./account-store.js";
import { getSng, registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
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

async function finishHeadsUpHandAsHumanFold(
  app: Awaited<ReturnType<typeof buildApp>>,
  tableId: string,
  playerId: string,
  token: string,
  initial: { hand?: unknown; handInProgress?: boolean },
) {
  let body: {
    hand?: {
      actionSeat: number | null;
      players: { playerId: string; seatIndex: number; allIn?: boolean; folded?: boolean }[];
    } | null;
    handInProgress?: boolean;
    playthrough?: { handsPlayed: number; unlockedMojos: string };
  } = { ...(initial as typeof body) };
  for (let i = 0; i < 40 && (body.hand || body.handInProgress); i++) {
    if (body.hand?.actionSeat != null) {
      const actor = body.hand.players.find((p) => p.seatIndex === body.hand!.actionSeat);
      const me = body.hand.players.find((p) => p.playerId === playerId);
      if (actor?.playerId === playerId && me && !me.allIn && !me.folded) {
        const act = await app.inject({
          method: "POST",
          url: `/v1/tables/${tableId}/hands/action`,
          headers: auth(token),
          payload: { playerId, action: "fold" },
        });
        expect(act.statusCode).toBe(200);
        body = JSON.parse(act.body);
        continue;
      }
    }
    const poll = await app.inject({
      method: "GET",
      url: `/v1/tables/${tableId}?playerId=${encodeURIComponent(playerId)}`,
      headers: auth(token),
    });
    body = JSON.parse(poll.body);
  }
  const finalPoll = await app.inject({
    method: "GET",
    url: `/v1/tables/${tableId}?playerId=${encodeURIComponent(playerId)}`,
    headers: auth(token),
  });
  return JSON.parse(finalPoll.body) as typeof body & {
    handInProgress: boolean;
    playthrough?: { handsPlayed: number; unlockedMojos: string; handsRequired: number };
    seats: { playerId: string; handsPlayed: number; unlockedMojos: string }[];
  };
}

async function playSngFolds(
  app: Awaited<ReturnType<typeof buildApp>>,
  tableId: string,
  playerId: string,
  token: string,
  hands: number,
) {
  let last: Awaited<ReturnType<typeof finishHeadsUpHandAsHumanFold>> | null = null;
  for (let n = 0; n < hands; n++) {
    const go = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/go`,
      headers: auth(token),
      payload: { playerId },
    });
    expect(go.statusCode).toBe(200);
    last = await finishHeadsUpHandAsHumanFold(app, tableId, playerId, token, JSON.parse(go.body));
    expect(last.handInProgress).toBe(false);
  }
  return last!;
}

describe("SNG play-through unlocks", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    process.env.DAT_EMAIL_MODE = "memory";
    process.env.DAT_PLAY_COMPLIANCE_MODE = "test";
    process.env.DAT_TERMS_ACCEPTANCE_PATH = "memory";
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
    process.env.DAT_DAILY_REDEEM_MOJOS = "5000000";
    resetMailOutboxForTests();
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
    resetUsersForTests();
    resetIpRateLimitsForTests();
  });

  it("unlocks 1 DAT per completed SNG hand and keeps it after a bust", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1sngunlock");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);

    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-sng",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body) as { tableId: string; playthrough?: { handsRequired: number } };
    expect(body.playthrough?.handsRequired).toBe(1000);

    const after = await playSngFolds(app, body.tableId, alice.session.playerId, alice.token, 2);
    const seated = after.seats.find((s) => s.playerId === alice.session.playerId);
    expect(seated?.handsPlayed).toBe(2);
    expect(seated?.unlockedMojos).toBe("2000");
    expect(after.playthrough?.handsPlayed).toBe(2);
    expect(after.playthrough?.unlockedMojos).toBe("2000");

    const sng = getSng(body.tableId);
    expect(sng).toBeDefined();
    sng!.engine.setPlayerStack(alice.session.playerId, 0n);
    const bust = await app.inject({
      method: "GET",
      url: `/v1/tables/${body.tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });
    expect(bust.statusCode).toBe(200);
    const busted = JSON.parse(bust.body) as {
      sng: { status: string };
      playthrough: { handsPlayed: number; unlockedMojos: string; handsRequired: number };
    };
    expect(busted.sng.status).toBe("finished");
    expect(busted.playthrough.handsPlayed).toBe(2);
    expect(busted.playthrough.unlockedMojos).toBe("2000");
    expect(busted.playthrough.handsRequired).toBeGreaterThan(0);

    const acc = await app.inject({
      method: "GET",
      url: `/v1/wallet/account?address=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });
    const account = JSON.parse(acc.body) as {
      balanceMojos: string;
      playthrough: { handsPlayed: number; unlockedMojos: string };
    };
    expect(account.playthrough.handsPlayed).toBe(2);
    expect(account.playthrough.unlockedMojos).toBe("2000");
    expect(BigInt(account.balanceMojos)).toBeGreaterThan(0n);

    const withdrawn = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, fromAccount: true, devAck: true },
    });
    expect(withdrawn.statusCode).toBe(200);
    const out = JSON.parse(withdrawn.body) as {
      stackMojos: string;
      playthrough: { unlockedMojos: string; handsPlayed: number };
    };
    expect(out.stackMojos).toBe("2000");
    expect(out.playthrough.unlockedMojos).toBe("0");
    await app.close();
  });

  it("keeps SNG unlocks when the buy-in used the last of the account", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1sngbroke");
    tryRedeemDaily(alice.session.playerId, 1_000_000n);

    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-sng",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joined.statusCode).toBe(200);
    const body = JSON.parse(joined.body) as { tableId: string };
    expect(getAccountBalance(alice.session.playerId)).toBe(0n);

    await playSngFolds(app, body.tableId, alice.session.playerId, alice.token, 3);
    expect(getPlaythrough(alice.session.playerId).handsPlayed).toBe(3);
    expect(getPlaythrough(alice.session.playerId).poolMojos).toBe(1_000_000n);

    const sng = getSng(body.tableId)!;
    sng.engine.setPlayerStack(alice.session.playerId, 0n);
    await app.inject({
      method: "GET",
      url: `/v1/tables/${body.tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
      headers: auth(alice.token),
    });

    const pt = getPlaythrough(alice.session.playerId);
    expect(pt.handsPlayed).toBe(3);
    expect(pt.poolMojos).toBe(1_000_000n);
    expect(getAccountBalance(alice.session.playerId)).toBe(0n);

    creditAccount(alice.session.playerId, 5_000_000n);

    const withdrawn = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth(alice.token),
      payload: {
        tableId: body.tableId,
        playerId: alice.session.playerId,
        fromAccount: true,
        devAck: true,
      },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(JSON.parse(withdrawn.body).stackMojos).toBe("3000");
    await app.close();
  });

  it("rejects cashing out an SNG tournament stack", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1sngcashout");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    const joined = await app.inject({
      method: "POST",
      url: "/v1/tables/join-sng",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    const tableId = JSON.parse(joined.body).tableId as string;
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth(alice.token),
      payload: { tableId, playerId: alice.session.playerId, toAccount: true, devAck: true },
    });
    expect(blocked.statusCode).toBe(400);
    expect(JSON.parse(blocked.body).error).toMatch(/tournament chips/i);
    await app.close();
  });
});
