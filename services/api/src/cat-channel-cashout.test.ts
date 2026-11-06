import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { ChiaGamingClient, generateChannelKey, bytesToHex } from "@dat-poker/chia-bridge";
import { getAccountBalance, resetAccountsForTests, tryRedeemDaily } from "./account-store.js";
import { isCatChannelTable } from "./cat-channel-store.js";
import { issueTestSession, resetPlayerSessionsForTests } from "./player-session.js";
import { registerCatChannelRoutes } from "./routes/cat-channel.js";
import { registerTableRoutes, resetTablesForTests } from "./routes/tables.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { serializeForJson } from "./serialize.js";

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
  registerTableRoutes(api);
  registerCatChannelRoutes(api);
  registerWalletRoutes(api, chia);
  return api;
}

describe("heads-up DAT channel cash out", () => {
  const previous = {
    dev: process.env.DAT_ALLOW_DEV_BUYIN,
    min: process.env.DAT_MIN_BUY_IN_MOJOS,
    channel: process.env.DAT_CAT_CHANNEL_TEST,
  };

  beforeEach(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_MIN_BUY_IN_MOJOS = BUY_IN;
    process.env.DAT_CAT_CHANNEL_TEST = "true";
    resetTablesForTests();
    resetAccountsForTests();
    resetPlayerSessionsForTests();
  });

  afterAll(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = previous.dev;
    if (previous.min === undefined) delete process.env.DAT_MIN_BUY_IN_MOJOS;
    else process.env.DAT_MIN_BUY_IN_MOJOS = previous.min;
    if (previous.channel === undefined) delete process.env.DAT_CAT_CHANNEL_TEST;
    else process.env.DAT_CAT_CHANNEL_TEST = previous.channel;
    resetTablesForTests();
  });

  it("returns the table stack to the account and closes the channel", async () => {
    const api = app();
    const alice = issueTestSession("xch1channelcash");
    expect(tryRedeemDaily(alice.session.playerId, 5_000_000n).credited).toBe(true);
    const auth = { authorization: `Bearer ${alice.token}` };
    const key = generateChannelKey();

    const created = await api.inject({
      method: "POST",
      url: "/v1/tables",
      headers: auth,
      payload: { custody: "cat-channel", maxSeats: 2 },
    });
    expect(created.statusCode, created.body).toBe(200);
    const tableId = created.json().tableId as string;

    const seat = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/seat`,
      headers: auth,
      payload: { playerId: alice.session.playerId, seatIndex: 0, buyInMojos: BUY_IN },
    });
    expect(seat.statusCode, seat.body).toBe(200);
    const house = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/seat-house`,
      headers: auth,
      payload: { buyInMojos: BUY_IN },
    });
    expect(house.statusCode, house.body).toBe(200);

    const opened = await api.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/cat-channel/open`,
      headers: auth,
      payload: {
        alicePublicKey: bytesToHex(key.publicKey),
        alicePayoutPuzzleHash: createHash("sha256").update(key.publicKey).digest("hex"),
      },
    });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(isCatChannelTable(tableId)).toBe(true);
    expect(getAccountBalance(alice.session.playerId)).toBe(4_000_000n);

    const blocked = await api.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth,
      payload: { tableId, playerId: alice.session.playerId },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/Cash out to your account/);

    const cashed = await api.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: auth,
      payload: { tableId, playerId: alice.session.playerId, toAccount: true },
    });
    expect(cashed.statusCode, cashed.body).toBe(200);
    expect(cashed.json().stillSeated).toBe(false);
    expect(cashed.json().stackMojos).toBe(BUY_IN);
    expect(cashed.json().note).toMatch(/channel closed/i);
    expect(getAccountBalance(alice.session.playerId)).toBe(5_000_000n);
    expect(isCatChannelTable(tableId)).toBe(false);
    await api.close();
  });
});
