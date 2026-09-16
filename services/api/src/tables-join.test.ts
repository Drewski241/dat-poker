import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { resetAccountsForTests, tryRedeemDaily } from "./account-store.js";
import { registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerWalletRoutes } from "./routes/wallet.js";
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
  registerWalletRoutes(app, chia);
  registerTableRoutes(app);
  registerHandRoutes(app);
  return app;
}

describe("6-max join + daily redeem", () => {
  beforeEach(() => {
    resetTablesForTests();
    resetAccountsForTests();
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
    process.env.DAT_DAILY_REDEEM_MOJOS = "5000000";
  });

  it("redeems 5000 DAT once per day and seats a second human at the same 6-max table", async () => {
    const app = await buildApp();

    const redeemA = await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      payload: { playerId: "xch1alice", devAck: true },
    });
    expect(redeemA.statusCode).toBe(200);
    expect(JSON.parse(redeemA.body).creditedMojos).toBe("5000000");

    const redeemAgain = await app.inject({
      method: "POST",
      url: "/v1/wallet/redeem",
      payload: { playerId: "xch1alice", devAck: true },
    });
    expect(redeemAgain.statusCode).toBe(429);

    const joinA = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      payload: { playerId: "xch1alice", buyInMojos: "1000000", devAck: true },
    });
    expect(joinA.statusCode).toBe(200);
    const tableA = JSON.parse(joinA.body);
    expect(tableA.maxSeats).toBe(6);
    expect(tableA.seats).toHaveLength(2);
    expect(tableA.seats.some((s: { playerId: string }) => s.playerId === "dat-poker:house")).toBe(
      true,
    );

    tryRedeemDaily("xch1bob", 5_000_000n);
    const joinB = await app.inject({
      method: "POST",
      url: "/v1/tables/join",
      payload: { playerId: "xch1bob", buyInMojos: "1000000", devAck: true },
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
      payload: { playerId: "xch1alice" },
    });
    expect(go.statusCode).toBe(200);
    const dealt = JSON.parse(go.body);
    const alice = dealt.hand.players.find((p: { playerId: string }) => p.playerId === "xch1alice");
    const bob = dealt.hand.players.find((p: { playerId: string }) => p.playerId === "xch1bob");
    expect(alice.holeCards).toHaveLength(2);
    expect(bob.holeCards).toHaveLength(0);

    await app.close();
  });
});
