import type { FastifyInstance } from "fastify";
import {
  beginCloudWalletConnect,
  cloudPlayerFromRequest,
  disconnectCloudWallet,
  finishCloudWalletCallback,
  publicCloudWalletStatus,
} from "../cloud-wallet.js";

export function registerCloudWalletRoutes(app: FastifyInstance): void {
  app.get("/v1/wallet/cloud", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const player = await cloudPlayerFromRequest(req);
    return publicCloudWalletStatus(player);
  });

  app.post("/v1/wallet/cloud/connect", async (_req, reply) => {
    const started = await beginCloudWalletConnect(reply);
    if (!started) {
      return reply.status(404).send({ error: "Unavailable" });
    }
    reply.header("cache-control", "no-store");
    return started;
  });

  app.get("/v1/wallet/cloud/callback", async (req, reply) => {
    return finishCloudWalletCallback(req, reply);
  });

  app.post("/v1/wallet/cloud/disconnect", async (req, reply) => {
    await disconnectCloudWallet(req, reply);
    return { ok: true };
  });
}
