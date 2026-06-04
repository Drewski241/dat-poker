import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { buildPayoutOffer, readTreasuryServiceConfig, type PayoutRequestBody } from "./payout.js";
import { pingWalletRpc } from "@dat-poker/chia-bridge";

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
      walletRpcReachable = await pingWalletRpc(config.walletRpc);
    }
    return {
      status: "ok",
      offerMode: config.offerMode,
      assetId: config.defaultAssetId,
      walletRpcUrl: config.walletRpc.url,
      walletConfigured,
      walletRpcReachable,
    };
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
