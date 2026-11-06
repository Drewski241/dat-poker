import { createHash } from "node:crypto";
import { generateChannelKey, signAug, bytesToHex } from "@dat-poker/chia-bridge";
import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

process.env.DAT_CAT_CHANNEL_TEST = "true";
process.env.DAT_ALLOW_DEV_BUYIN = "true";

describe("heads-up DAT channel routes", () => {
  let app: FastifyInstance;
  const alice = generateChannelKey(new Uint8Array(48).fill(7));
  const aliceId = bytesToHex(alice.publicKey);

  beforeAll(async () => {
    app = await buildApp();
  });

  it("plays a fold, moves the co-signed pot, and proves preempt", async () => {
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { custody: "cat-channel", maxSeats: 6 },
    });
    expect(rejected.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/v1/tables",
      payload: { custody: "cat-channel" },
    });
    expect(created.statusCode).toBe(200);
    const { tableId, config } = created.json() as { tableId: string; config: { minBuyInMojos: string } };
    const buyIn = config.minBuyInMojos;

    const seat = (playerId: string, seatIndex: number) =>
      app.inject({
        method: "POST",
        url: `/v1/tables/${tableId}/seat`,
        payload: { playerId, seatIndex, buyInMojos: buyIn, channelTest: true },
      });
    expect((await seat(aliceId, 0)).statusCode).toBe(200);
    expect((await seat("dat-poker:house", 1)).statusCode).toBe(200);

    const payout = createHash("sha256").update(alice.publicKey).digest("hex");
    const opened = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/cat-channel/open`,
      payload: { alicePublicKey: aliceId, alicePayoutPuzzleHash: payout },
    });
    expect(opened.statusCode).toBe(200);
    let channel = opened.json().channel as {
      signed: boolean;
      stateMessageHex: string;
      sequence: number;
      catPuzzleHashHex: string;
      coinIdSimulated: boolean;
      aliceAmount: string;
      bobAmount: string;
    };
    expect(channel.signed).toBe(false);
    expect(channel.catPuzzleHashHex).toHaveLength(64);
    expect(channel.coinIdSimulated).toBe(true);

    const signed = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/cat-channel/state-signature`,
      payload: {
        playerId: aliceId,
        signature: bytesToHex(signAug(alice.secretKey, bytesToHexToBytes(channel.stateMessageHex))),
      },
    });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().channel.signed).toBe(true);

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/start`,
      payload: {},
    });
    expect(blocked.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/seed`,
      payload: { playerId: aliceId },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/seed`,
      payload: { playerId: "dat-poker:house" },
    });
    await app.inject({ method: "POST", url: `/v1/tables/${tableId}/hands/deal`, payload: {} });
    const folded = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/hands/action`,
      payload: { playerId: aliceId, action: "fold" },
    });
    expect(folded.statusCode).toBe(200);
    channel = folded.json().channel;
    expect(channel.sequence).toBe(1);
    expect(channel.signed).toBe(false);

    const resigned = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/cat-channel/state-signature`,
      payload: {
        playerId: aliceId,
        signature: bytesToHex(signAug(alice.secretKey, bytesToHexToBytes(channel.stateMessageHex))),
      },
    });
    channel = resigned.json().channel;
    expect(channel.signed).toBe(true);
    expect(BigInt(channel.bobAmount)).toBeGreaterThan(BigInt(buyIn));
    expect(BigInt(channel.aliceAmount) + BigInt(channel.bobAmount)).toBe(BigInt(buyIn) * 2n);

    const close = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/cat-channel/prove`,
      payload: { kind: "close" },
    });
    expect(close.statusCode).toBe(200);
    const closeOps = close.json().conditions.map((condition: { opcode: number }) => condition.opcode);
    expect(closeOps).toEqual([50, 50, 73, 51, 51]);

    const preempt = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/cat-channel/prove`,
      payload: { kind: "preempt" },
    });
    expect(preempt.statusCode).toBe(200);
    const preemptOps = preempt.json().conditions.map((condition: { opcode: number }) => condition.opcode);
    expect(preemptOps[0]).toBe(49);
    expect(preemptOps).not.toContain(82);

    const withdraw = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      payload: { tableId, playerId: aliceId, devAck: true },
    });
    expect(withdraw.statusCode).toBe(400);
  });
});

function bytesToHexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}
