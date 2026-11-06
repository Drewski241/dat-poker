import type { FastifyInstance } from "fastify";
import { readDatTokenConfig } from "../wallet-config.js";
import {
  houseCloseSignature,
  openCatChannel,
  proveCatChannel,
  submitCatChannelCloseShare,
  submitCatChannelStateShare,
} from "../cat-channel-store.js";
import { getTableCustody, getTableEngine } from "./tables.js";

const TEST_ASSET = "11".repeat(32);

export function registerCatChannelRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { tableId: string };
    Body: {
      alicePublicKey?: string;
      alicePayoutPuzzleHash?: string;
      bobPublicKey?: string;
      bobPayoutPuzzleHash?: string;
      timeoutBlocks?: number;
      assetId?: string;
      parentCoinId?: string;
    };
  }>("/v1/tables/:tableId/cat-channel/open", async (req, reply) => {
    const table = getTableEngine(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    if (getTableCustody(req.params.tableId) !== "cat-channel") {
      return reply.status(400).send({ error: "This table is not a heads-up DAT channel" });
    }
    const seats = table.getSeatedPlayers();
    if (seats.length !== 2) {
      return reply.status(400).send({ error: "Seat exactly two players before opening the channel" });
    }
    if (table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the current hand before opening the channel" });
    }
    const dat = readDatTokenConfig();
    const assetId = req.body.assetId?.trim() || dat.assetId || (process.env.DAT_CAT_CHANNEL_TEST === "true" ? TEST_ASSET : "");
    if (!/^[0-9a-fA-F]{64}$/.test(assetId)) {
      return reply.status(400).send({ error: "DAT asset id must be 64 hex characters" });
    }
    if (!req.body.alicePublicKey || !req.body.alicePayoutPuzzleHash) {
      return reply.status(400).send({ error: "Alice public key and payout puzzle hash are required" });
    }
    const [alice, bob] = seats;
    try {
      const channel = openCatChannel({
        tableId: req.params.tableId,
        assetIdHex: assetId.toLowerCase(),
        network: process.env.CHIA_NETWORK === "testnet" ? "testnet" : "mainnet",
        timeoutBlocks: req.body.timeoutBlocks ?? 32,
        alice: {
          playerId: alice.playerId,
          publicKeyHex: req.body.alicePublicKey,
          payoutPuzzleHashHex: req.body.alicePayoutPuzzleHash,
        },
        bob: {
          playerId: bob.playerId,
          publicKeyHex: req.body.bobPublicKey,
          payoutPuzzleHashHex: req.body.bobPayoutPuzzleHash,
        },
        aliceAmount: alice.stackMojos,
        bobAmount: bob.stackMojos,
        parentCoinIdHex: req.body.parentCoinId,
      });
      return { channel };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { playerId?: string; signature?: string };
  }>("/v1/tables/:tableId/cat-channel/state-signature", async (req, reply) => {
    if (!req.body.playerId || !req.body.signature) {
      return reply.status(400).send({ error: "playerId and signature are required" });
    }
    try {
      return { channel: submitCatChannelStateShare(req.params.tableId, req.body.playerId, req.body.signature) };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { playerId?: string; signature?: string };
  }>("/v1/tables/:tableId/cat-channel/close-signature", async (req, reply) => {
    if (!req.body.playerId || !req.body.signature) {
      return reply.status(400).send({ error: "playerId and signature are required" });
    }
    try {
      const channel = submitCatChannelCloseShare(req.params.tableId, req.body.playerId, req.body.signature);
      const houseSignature = houseCloseSignature(req.params.tableId);
      if (houseSignature && !channel.closeShares.bob) {
        return {
          channel: submitCatChannelCloseShare(req.params.tableId, "dat-poker:house", houseSignature),
        };
      }
      return { channel };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { kind?: "close" | "settle" | "preempt" };
  }>("/v1/tables/:tableId/cat-channel/prove", async (req, reply) => {
    const kind = req.body.kind ?? "close";
    if (kind !== "close" && kind !== "settle" && kind !== "preempt") {
      return reply.status(400).send({ error: "kind must be close, settle, or preempt" });
    }
    try {
      const result = proveCatChannel(req.params.tableId, kind);
      if (!result.ok) return reply.status(400).send({ error: result.error ?? "Puzzle rejected the spend" });
      return { kind, conditions: result.conditions };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });
}
