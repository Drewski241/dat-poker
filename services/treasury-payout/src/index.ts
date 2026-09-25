import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { buildPayoutOffer, readTreasuryServiceConfig, type PayoutRequestBody } from "./payout.js";
import {
  describeMissingSageCerts,
  describeSageLoginNeeded,
  describeSageNoSpendableCoins,
  ensureSageTreasuryReady,
  pingTreasuryWalletRpc,
  readSageTreasuryFunds,
  sageLooksStillSyncing,
} from "@dat-poker/chia-bridge";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

async function main(): Promise<void> {
  const config = readTreasuryServiceConfig();
  if (config.offerMode === "rpc") {
    try {
      config.walletRpc = await ensureSageTreasuryReady(config.walletRpc);
    } catch {
      /* Sage may not have a key yet — /health reports reachable false */
    }
  }
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => {
    const walletConfigured = Boolean(config.walletRpc.certPath && config.walletRpc.keyPath);
    let walletRpcReachable: boolean | null = null;
    if (config.offerMode === "rpc" && walletConfigured) {
      try {
        config.walletRpc = await ensureSageTreasuryReady(config.walletRpc);
      } catch {
        /* login / import is best-effort on /health */
      }
      walletRpcReachable = await pingTreasuryWalletRpc(config.walletRpc);
    }
    const fingerprintSet = Boolean(config.walletRpc.sageFingerprint);
    const funds =
      config.offerMode === "rpc" && walletConfigured && walletRpcReachable
        ? await readSageTreasuryFunds(config.walletRpc, config.defaultAssetId ?? undefined)
        : null;
    const noSpendableDat =
      funds != null &&
      (funds.datSelectableMojos === 0n ||
        (sageLooksStillSyncing(funds) && (funds.datSelectableMojos == null || funds.datSelectableMojos === 0n)));
    return {
      status: "ok",
      offerMode: config.offerMode,
      walletBackend: config.walletRpc.backend,
      assetId: config.defaultAssetId,
      walletRpcUrl: config.walletRpc.url,
      walletConfigured,
      walletRpcReachable,
      walletError:
        config.offerMode === "rpc" && !walletConfigured
          ? describeMissingSageCerts()
          : config.offerMode === "rpc" && walletConfigured && walletRpcReachable === false
            ? describeSageLoginNeeded(fingerprintSet)
            : noSpendableDat
              ? describeSageNoSpendableCoins(funds ?? undefined)
              : null,
      sageFingerprint: config.walletRpc.sageFingerprint ?? null,
      treasuryAddress: funds?.address ?? config.treasuryAddress,
      sageSyncedCoins: funds?.syncedCoins ?? null,
      sageTotalCoins: funds?.totalCoins ?? null,
      datSelectableMojos: funds?.datSelectableMojos?.toString() ?? null,
      xchSelectableMojos: funds?.xchSelectableMojos?.toString() ?? null,
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
