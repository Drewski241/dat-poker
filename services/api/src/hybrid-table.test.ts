import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { serializeForJson } from "./serialize.js";
import { registerHandRoutes } from "./routes/hands.js";
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
  registerHandRoutes(api);
  registerWalletRoutes(api, chia);
  return api;
}

async function seat(
  api: ReturnType<typeof app>,
  tableId: string,
  playerId: string,
  seatIndex: number,
) {
  const res = await api.inject({
    method: "POST",
    url: `/v1/tables/${tableId}/seat`,
    payload: { playerId, seatIndex, buyInMojos: BUY_IN, devAck: true },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("hybrid tables", () => {
  const previous = {
    dev: process.env.DAT_ALLOW_DEV_BUYIN,
    asset: process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID,
    min: process.env.DAT_MIN_BUY_IN_MOJOS,
    treasury: process.env.DAT_TREASURY_PAYOUT_URL,
  };

  beforeAll(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID = "ab".repeat(32);
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    process.env.DAT_MIN_BUY_IN_MOJOS = BUY_IN;
  });

  afterAll(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = previous.dev;
    if (previous.asset === undefined) delete process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID;
    else process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID = previous.asset;
    if (previous.min === undefined) delete process.env.DAT_MIN_BUY_IN_MOJOS;
    else process.env.DAT_MIN_BUY_IN_MOJOS = previous.min;
    if (previous.treasury === undefined) delete process.env.DAT_TREASURY_PAYOUT_URL;
    else process.env.DAT_TREASURY_PAYOUT_URL = previous.treasury;
  });

  it("refuses an XCH wager and opens a DAT chia-gaming session at two players", async () => {
    const api = app();
    const refused = await api.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { unit: "xch", maxSeats: 2 },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/DAT governance token/);

    const created = await api.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { variant: "nlhe", format: "cash", maxSeats: 2, unit: "dat" },
    });
    expect(created.statusCode).toBe(200);
    const { tableId, hybrid } = created.json();
    expect(hybrid.mode).toBe("waiting");
    expect(hybrid.wagerAsset).toBe("dat");
    expect(hybrid.xchWagerMojos).toBe("0");

    await seat(api, tableId, "alice", 0);
    const seated = await seat(api, tableId, "bob", 1);
    expect(seated.hybrid.mode).toBe("chia-gaming-heads-up");
    expect(seated.hybrid.session.gameRelayUrl).toBe("ws://localhost:3001/ws/game");
    expect(seated.hybrid.session.rules).toBe("engine-result-on-channel");
    expect(seated.hybrid.session.xchWagerMojos).toBe("0");
    expect(seated.hybrid.session.playerAStakeMojos).toBe(BUY_IN);
    await api.close();
  });

  it("keeps Calpoker on the upstream referee and does not deal it as NLHE", async () => {
    const api = app();
    const created = await api.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { variant: "calpoker", maxSeats: 2 },
    });
    const { tableId } = created.json();
    await seat(api, tableId, "alice", 0);
    const seated = await seat(api, tableId, "bob", 1);
    expect(seated.hybrid.session.rules).toBe("chia-gaming-referee");

    const start = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/start`,
      payload: {},
    });
    expect(start.statusCode).toBe(400);
    expect(start.json().error).toMatch(/calpoker/);
    await api.close();
  });

  it("opens a DAT vault at three players, co-signs the hand, then promotes to a channel", async () => {
    const api = app();
    const created = await api.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { variant: "nlhe", format: "mtt", maxSeats: 6 },
    });
    const { tableId } = created.json();
    await seat(api, tableId, "alice", 0);
    await seat(api, tableId, "bob", 1);
    const third = await seat(api, tableId, "cara", 2);
    expect(third.hybrid.mode).toBe("dat-table-vault");
    expect(third.hybrid.vault.status).toBe("open");
    expect(third.hybrid.headsUpPromotion).toBe(true);
    expect(third.hybrid.session).toBeNull();

    const start = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/start`,
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    for (const playerId of ["alice", "bob", "cara"]) {
      const seed = await api.inject({
        method: "POST",
        url: `/v1/tables/${tableId}/hands/seed`,
        payload: { playerId },
      });
      expect(seed.statusCode).toBe(200);
    }
    const dealt = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/deal`,
      payload: {},
    });
    expect(dealt.statusCode).toBe(200);

    let handId: string | null = null;
    for (let step = 0; step < 12; step += 1) {
      const view = await api.inject({ method: "GET", url: `/v1/tables/${tableId}` });
      const body = view.json();
      if (!body.hand) {
        handId = body.lastHandResult.handId;
        break;
      }
      const actor = body.hand.players.find(
        (player: { seatIndex: number; folded: boolean }) =>
          player.seatIndex === body.hand.actionSeat && !player.folded,
      );
      const action = await api.inject({
        method: "POST",
        url: `/v1/tables/${tableId}/hands/action`,
        payload: { playerId: actor.playerId, action: "fold" },
      });
      expect(action.statusCode).toBe(200);
    }
    expect(handId).toBeTruthy();

    const early = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/vault/cosign`,
      payload: { playerId: "alice" },
    });
    expect(early.json().completed).toBe(false);

    await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/vault/cosign`,
      payload: { playerId: "bob" },
    });
    const done = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/vault/cosign`,
      payload: { playerId: "cara" },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().completed).toBe(true);
    expect(done.json().hybrid.vault.lastCoSigned.handId).toBe(handId);

    const left = await api.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      payload: { tableId, playerId: "cara", devAck: true },
    });
    expect(left.statusCode, left.body).toBe(200);

    const promoted = await api.inject({ method: "GET", url: `/v1/tables/${tableId}` });
    const hybrid = promoted.json().hybrid;
    expect(hybrid.mode).toBe("chia-gaming-heads-up");
    expect(hybrid.vault.status).toBe("frozen-for-heads-up");
    expect(hybrid.session.rules).toBe("engine-result-on-channel");
    expect(hybrid.session.xchWagerMojos).toBe("0");
    expect([hybrid.session.playerA, hybrid.session.playerB].sort()).toEqual(["alice", "bob"]);
    await api.close();
  });
});
