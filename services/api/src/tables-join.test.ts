import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests, tryRedeemDaily } from "./account-store.js";
import { registerTableRoutes, resetTablesForTests, returnAllStacksToAccounts } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { resetUsersForTests } from "./user-store.js";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { issueTestSession, resetPlayerSessionsForTests } from "./player-session.js";
import { signChip0002ForTests } from "./chip0002.js";
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

describe("6-max join + daily redeem", () => {
  beforeEach(() => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_SCRYPT_N = "4096";
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
    resetUsersForTests();
    resetIpRateLimitsForTests();
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
    process.env.DAT_DAILY_REDEEM_MOJOS = "5000000";
  });

  it("redeems 5000 DAT once per day and seats a second human at the same 6-max table", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1alice");
    const bob = issueTestSession("xch1bob");

    const redeemA = await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, devAck: true },
    });
    expect(redeemA.statusCode).toBe(200);
    expect(JSON.parse(redeemA.body).creditedMojos).toBe("5000000");

    const redeemAgain = await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, devAck: true },
    });
    expect(redeemAgain.statusCode).toBe(429);

    const joinA = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joinA.statusCode).toBe(200);
    const tableA = JSON.parse(joinA.body);
    expect(tableA.maxSeats).toBe(6);
    expect(tableA.seats).toHaveLength(2);
    expect(tableA.seats.some((s: { playerId: string }) => s.playerId === "dat-poker:house")).toBe(
      true,
    );

    tryRedeemDaily(bob.session.playerId, 5_000_000n);
    const joinB = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(bob.token),
      payload: { playerId: bob.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(joinB.statusCode).toBe(200);
    const tableB = JSON.parse(joinB.body);
    expect(tableB.tableId).toBe(tableA.tableId);
    expect(tableB.humans).toBe(2);
    expect(tableB.seats.some((s: { playerId: string }) => s.playerId === "dat-poker:house")).toBe(
      false,
    );

    const go = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableB.tableId}/hands/go`,
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId },
    });
    expect(go.statusCode).toBe(200);
    const dealt = JSON.parse(go.body);
    const aliceHand = dealt.hand.players.find(
      (p: { playerId: string }) => p.playerId === alice.session.playerId,
    );
    const bobHand = dealt.hand.players.find(
      (p: { playerId: string }) => p.playerId === bob.session.playerId,
    );
    expect(aliceHand.holeCards).toHaveLength(2);
    expect(bobHand.holeCards).toHaveLength(0);

    await app.close();
  });

  it("blocks withdraw until one hand per DAT token of buy-in is played", async () => {
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000";
    const app = await buildApp();
    const carol = issueTestSession("xch1carol");
    tryRedeemDaily(carol.session.playerId, 5_000_000n);

    const joined = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tables/join",
          headers: auth(carol.token),
          payload: { playerId: carol.session.playerId, buyInMojos: "1000", devAck: true },
        })
      ).body,
    );
    expect(
      joined.seats.find((s: { playerId: string }) => s.playerId === carol.session.playerId)
        .handsRequired,
    ).toBe(1);

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth(carol.token),
      payload: { tableId: joined.tableId, playerId: carol.session.playerId, devAck: true },
    });
    expect(blocked.statusCode).toBe(400);
    expect(JSON.parse(blocked.body).error).toMatch(/Play through/i);

    const go = await app.inject({
      method: "POST",
      url: `/v1/tables/${joined.tableId}/hands/go`,
      headers: auth(carol.token),
      payload: { playerId: carol.session.playerId },
    });
    expect(go.statusCode).toBe(200);
    let body = JSON.parse(go.body);
    for (let i = 0; i < 20 && body.hand; i++) {
      const actor = body.hand.players.find(
        (p: { seatIndex: number }) => p.seatIndex === body.hand.actionSeat,
      );
      if (!actor || actor.playerId !== carol.session.playerId) {
        break;
      }
      const act = await app.inject({
        method: "POST",
        url: `/v1/tables/${joined.tableId}/hands/action`,
        headers: auth(carol.token),
        payload: { playerId: carol.session.playerId, action: "fold" },
      });
      body = JSON.parse(act.body);
    }
    expect(body.hand).toBeNull();

    const allowed = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth(carol.token),
      payload: { tableId: joined.tableId, playerId: carol.session.playerId, devAck: true },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("rejects unauthenticated redeem, join, and hole-card peeking", async () => {
    const app = await buildApp();
    const alice = issueTestSession("xch1alice");
    const bob = issueTestSession("xch1bob");
    tryRedeemDaily(alice.session.playerId, 5_000_000n);
    tryRedeemDaily(bob.session.playerId, 5_000_000n);

    const noAuthRedeem = await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      payload: { playerId: "xch1alice", devAck: true },
    });
    expect(noAuthRedeem.statusCode).toBe(401);

    await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    const joined = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tables/join",
          headers: auth(bob.token),
          payload: { playerId: bob.session.playerId, buyInMojos: "1000000", devAck: true },
        })
      ).body,
    );

    await app.inject({
      method: "POST",
      url: `/v1/tables/${joined.tableId}/hands/go`,
      headers: auth(alice.token),
      payload: { playerId: alice.session.playerId },
    });

    const spoofed = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/tables/${joined.tableId}?playerId=${encodeURIComponent(alice.session.playerId)}`,
        })
      ).body,
    );
    const spoofedAlice = spoofed.hand.players.find(
      (p: { playerId: string }) => p.playerId === alice.session.playerId,
    );
    expect(spoofedAlice.holeCards).toHaveLength(0);

    const bobView = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/tables/${joined.tableId}`,
          headers: auth(bob.token),
        })
      ).body,
    );
    const aliceFromBob = bobView.hand.players.find(
      (p: { playerId: string }) => p.playerId === alice.session.playerId,
    );
    const bobFromBob = bobView.hand.players.find(
      (p: { playerId: string }) => p.playerId === bob.session.playerId,
    );
    expect(aliceFromBob.holeCards).toHaveLength(0);
    expect(bobFromBob.holeCards).toHaveLength(2);

    const stolenAction = await app.inject({
      method: "POST",
      url: `/v1/tables/${joined.tableId}/hands/action`,
      headers: auth(bob.token),
      payload: { playerId: alice.session.playerId, action: "fold" },
    });
    expect(stolenAction.statusCode).toBe(403);

    const stolenJoin = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers: auth(bob.token),
      payload: { playerId: alice.session.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(stolenJoin.statusCode).toBe(403);

    await app.close();
  });

  it("issues a session only for a valid CHIP-0002 signature", async () => {
    const app = await buildApp();
    const address = "xch1sessiontester";
    const challenge = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/session/challenge?address=${encodeURIComponent(address)}`,
        })
      ).body,
    );
    const signed = signChip0002ForTests(new Uint8Array(32).fill(4), challenge.message);
    const created = await app.inject({
      method: "POST",
      url: "/v1/session",
      payload: {
        address,
        nonce: challenge.nonce,
        signature: signed.signature,
        pubkey: signed.pubkey,
      },
    });
    expect(created.statusCode).toBe(200);
    const body = JSON.parse(created.body);
    expect(body.token).toBeTruthy();
    expect(body.playerId).toMatch(/^pk_/);

    const forged = await app.inject({
      method: "POST",
      url: "/v1/session",
      payload: {
        address,
        nonce: challenge.nonce,
        signature: "00".repeat(96),
        pubkey: signed.pubkey,
      },
    });
    expect(forged.statusCode).toBe(400);
    await app.close();
  });

  it("lets a username account redeem and join without Sage", async () => {
    const app = await buildApp();
    const created = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { username: "betty", password: "password1" },
        })
      ).body,
    );
    const headers = auth(created.token);
    const redeem = await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      headers,
      payload: { playerId: created.playerId },
    });
    expect(redeem.statusCode).toBe(200);
    const join = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers,
      payload: { playerId: created.playerId, buyInMojos: "1000000", devAck: true },
    });
    expect(join.statusCode).toBe(200);
    const table = JSON.parse(join.body);
    expect(table.seats.some((s: { playerId: string }) => s.playerId === created.playerId)).toBe(true);
    await app.close();
  });

  it("keeps the account playerId when Sage is linked for withdraw", async () => {
    const app = await buildApp();
    const created = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { username: "sagewait", password: "password1" },
        })
      ).body,
    );
    const address = "xch1sagewaitlink";
    const challenge = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/session/challenge?address=${encodeURIComponent(address)}`,
        })
      ).body,
    );
    const signed = signChip0002ForTests(new Uint8Array(32).fill(7), challenge.message);
    const linked = await app.inject({
      method: "POST",
      url: "/v1/session/link",
      headers: auth(created.token),
      payload: {
        address,
        nonce: challenge.nonce,
        signature: signed.signature,
        pubkey: signed.pubkey,
      },
    });
    expect(linked.statusCode).toBe(200);
    const body = JSON.parse(linked.body);
    expect(body.playerId).toBe(created.playerId);
    expect(body.address).toBe(address);

    const me = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: auth(body.token),
        })
      ).body,
    );
    expect(me.playerId).toBe(created.playerId);
    expect(me.sageLinked).toBe(true);
    expect(me.sageAddress).toBe(address);
    await app.close();
  });

  it("cashes a username account out to the table ledger without Sage", async () => {
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000";
    const app = await buildApp();
    const created = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { username: "cashout", password: "password1" },
        })
      ).body,
    );
    const headers = auth(created.token);
    await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      headers,
      payload: { playerId: created.playerId },
    });
    const joined = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tables/join",
          headers,
          payload: { playerId: created.playerId, buyInMojos: "1000", devAck: true },
        })
      ).body,
    );
    const go = await app.inject({
      method: "POST",
      url: `/v1/tables/${joined.tableId}/hands/go`,
      headers,
      payload: { playerId: created.playerId },
    });
    let body = JSON.parse(go.body);
    for (let i = 0; i < 20 && body.hand; i++) {
      const actor = body.hand.players.find(
        (p: { seatIndex: number }) => p.seatIndex === body.hand.actionSeat,
      );
      if (!actor || actor.playerId !== created.playerId) {
        break;
      }
      const act = await app.inject({
        method: "POST",
        url: `/v1/tables/${joined.tableId}/hands/action`,
        headers,
        payload: { playerId: created.playerId, action: "fold" },
      });
      body = JSON.parse(act.body);
    }
    expect(body.hand).toBeNull();

    const cashed = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers,
      payload: { tableId: joined.tableId, playerId: created.playerId, toAccount: true },
    });
    expect(cashed.statusCode).toBe(200);
    const result = JSON.parse(cashed.body);
    expect(result.mode).toBe("ledger");
    expect(BigInt(result.accountMojos)).toBeGreaterThan(0n);
    await app.close();
  });

  it("returns a seated stack to the account ledger on restart", async () => {
    const app = await buildApp();
    const created = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: { username: "keepstack", password: "password1" },
        })
      ).body,
    );
    const headers = auth(created.token);
    await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      headers,
      payload: { playerId: created.playerId },
    });
    await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      headers,
      payload: { playerId: created.playerId, buyInMojos: "1000000", devAck: true },
    });
    const { returned } = returnAllStacksToAccounts();
    expect(returned).toBe(1);
    const acc = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/wallet/account?address=${encodeURIComponent(created.playerId)}`,
          headers,
        })
      ).body,
    );
    expect(acc.balanceMojos).toBe("5000000");
    await app.close();
  });
});
