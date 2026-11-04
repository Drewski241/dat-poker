import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { resetHouseTreasuryForTests } from "./house-lock.js";
import { serializeForJson } from "./serialize.js";
import { registerTableRoutes } from "./routes/tables.js";
import { registerWalletRoutes } from "./routes/wallet.js";

const BUY_IN = "1000000";

function app() {
  const api = Fastify();
  api.addHook("preSerialization", async (_request, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  const chia = new ChiaGamingClient({
    network: "testnet",
    lobbyUrl: "http://localhost:3001",
    gameUrl: "http://localhost:3000",
    coinsetUrl: "https://testnet11.api.coinset.org",
  });
  registerTableRoutes(api, chia);
  registerWalletRoutes(api, chia);
  return api;
}

describe("house treasury lock", () => {
  const previous = {
    dev: process.env.DAT_ALLOW_DEV_BUYIN,
    bankroll: process.env.DAT_TREASURY_BANKROLL_MOJOS,
    payout: process.env.DAT_TREASURY_PAYOUT_URL,
    asset: process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID,
    min: process.env.DAT_MIN_BUY_IN_MOJOS,
  };

  beforeAll(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_TREASURY_BANKROLL_MOJOS = BUY_IN;
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    delete process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID;
    process.env.DAT_MIN_BUY_IN_MOJOS = BUY_IN;
    resetHouseTreasuryForTests();
  });

  afterAll(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = previous.dev;
    if (previous.bankroll === undefined) delete process.env.DAT_TREASURY_BANKROLL_MOJOS;
    else process.env.DAT_TREASURY_BANKROLL_MOJOS = previous.bankroll;
    if (previous.payout === undefined) delete process.env.DAT_TREASURY_PAYOUT_URL;
    else process.env.DAT_TREASURY_PAYOUT_URL = previous.payout;
    if (previous.asset === undefined) delete process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID;
    else process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID = previous.asset;
    if (previous.min === undefined) delete process.env.DAT_MIN_BUY_IN_MOJOS;
    else process.env.DAT_MIN_BUY_IN_MOJOS = previous.min;
    resetHouseTreasuryForTests();
  });

  it("locks one house buy-in per tester and releases it when they leave", async () => {
    const api = app();

    const first = await api.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { maxSeats: 2, unit: "dat" },
    });
    const firstId = first.json().tableId as string;
    await api.inject({
      method: "POST",
      url: `/v1/tables/${firstId}/seat`,
      payload: { playerId: "alice", seatIndex: 0, buyInMojos: BUY_IN, devAck: true },
    });
    const locked = await api.inject({
      method: "POST",
      url: `/v1/tables/${firstId}/seat-house`,
      payload: { buyInMojos: BUY_IN },
    });
    expect(locked.statusCode).toBe(200);
    expect(locked.json().houseLock.tableLockedMojos).toBe(BUY_IN);
    expect(locked.json().houseLock.availableMojos).toBe("0");

    const second = await api.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { maxSeats: 2, unit: "dat" },
    });
    const secondId = second.json().tableId as string;
    const refused = await api.inject({
      method: "POST",
      url: `/v1/tables/${secondId}/seat-house`,
      payload: { buyInMojos: BUY_IN },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/not have enough free DAT/);

    const left = await api.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      payload: { tableId: firstId, playerId: "alice", devAck: true },
    });
    expect(left.statusCode).toBe(200);

    const freed = await api.inject({ method: "GET", url: "/v1/treasury/house" });
    expect(freed.json().availableMojos).toBe(BUY_IN);

    const accepted = await api.inject({
      method: "POST",
      url: `/v1/tables/${secondId}/seat-house`,
      payload: { buyInMojos: BUY_IN },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().houseLock.availableMojos).toBe("0");
    await api.close();
  });
});
