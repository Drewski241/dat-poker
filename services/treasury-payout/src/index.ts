import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { InsufficientHouseBankrollError, pingTreasuryWalletRpc } from "@dat-poker/chia-bridge";
import { lockTreasuryHouseBuyIn, settleTreasuryHouseTable, snapshotLocks } from "./locks.js";
import { buildPayoutOffer, readTreasuryServiceConfig, type PayoutRequestBody } from "./payout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

async function main(): Promise<void> {
  const config = readTreasuryServiceConfig();
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => {
    const walletConfigured = Boolean(config.walletRpc.certPath && config.walletRpc.keyPath);
    let walletRpcReachable: boolean | null = null;
    if (config.offerMode === "rpc" && walletConfigured) {
      walletRpcReachable = await pingTreasuryWalletRpc(config.walletRpc);
    }
    return {
      status: "ok",
      offerMode: config.offerMode,
      walletBackend: config.walletRpc.backend,
      assetId: config.defaultAssetId,
      walletRpcUrl: config.walletRpc.url,
      walletConfigured,
      walletRpcReachable,
      sageFingerprint: config.walletRpc.sageFingerprint ?? null,
    };
  });

  const publicLock = (tableId?: string) => {
    const snapshot = snapshotLocks(tableId);
    return {
      spendableMojos: snapshot.spendableMojos.toString(),
      lockedMojos: snapshot.lockedMojos.toString(),
      availableMojos: snapshot.availableMojos.toString(),
      tableLockedMojos: snapshot.tableLockedMojos?.toString() ?? null,
    };
  };

  app.get<{ Querystring: { tableId?: string } }>("/locks", async (req, reply) => {
    try {
      return publicLock(req.query.tableId);
    } catch (e) {
      return reply.status(503).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: { tableId?: string; amountMojos?: string } }>("/locks", async (req, reply) => {
    try {
      if (!req.body?.tableId || !req.body.amountMojos) {
        return reply.status(400).send({ error: "tableId and amountMojos required" });
      }
      const snapshot = lockTreasuryHouseBuyIn(req.body.tableId, BigInt(req.body.amountMojos));
      return {
        spendableMojos: snapshot.spendableMojos.toString(),
        lockedMojos: snapshot.lockedMojos.toString(),
        availableMojos: snapshot.availableMojos.toString(),
        tableLockedMojos: snapshot.tableLockedMojos?.toString() ?? null,
      };
    } catch (e) {
      const status = e instanceof InsufficientHouseBankrollError ? 409 : 400;
      return reply.status(status).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: { tableId?: string; spentMojos?: string } }>("/locks/settle", async (req, reply) => {
    try {
      if (!req.body?.tableId) {
        return reply.status(400).send({ error: "tableId required" });
      }
      const spent = BigInt(req.body.spentMojos ?? "0");
      const snapshot = settleTreasuryHouseTable(req.body.tableId, spent);
      return {
        spendableMojos: snapshot.spendableMojos.toString(),
        lockedMojos: snapshot.lockedMojos.toString(),
        availableMojos: snapshot.availableMojos.toString(),
        tableLockedMojos: snapshot.tableLockedMojos?.toString() ?? null,
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: PayoutRequestBody }>("/payout", async (req, reply) => {
    try {
      const result = await buildPayoutOffer(config, req.body);
      return {
        ok: true,
        offer: result.offer,
        mode: result.mode,
        recipient: req.body.address,
        amountMojos: req.body.amountMojos,
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Treasury payout service on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
