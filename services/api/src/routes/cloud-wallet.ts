import type { FastifyInstance } from "fastify";
import {
  cloudWalletPublic,
  cloudWalletReturnUrl,
  completeCloudWalletConnect,
  disconnectCloudWallet,
  startCloudWalletConnect,
} from "../cloud-wallet.js";
import { requirePlayer } from "../player-session.js";

export function registerCloudWalletRoutes(app: FastifyInstance): void {
  app.get("/v1/wallet/cloud", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    return cloudWalletPublic(session.playerId);
  });

  app.post("/v1/wallet/cloud/start", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    try {
      return { ok: true, ...startCloudWalletConnect(session.playerId) };
    } catch (e) {
      return reply.status(503).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/v1/wallet/cloud/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) {
        const message = error === "access_denied" ? "Cloud Wallet connect was cancelled." : "Cloud Wallet connect failed.";
        return reply.redirect(cloudWalletReturnUrl("error", message));
      }
      if (!code || !state) {
        return reply.redirect(cloudWalletReturnUrl("error", "Cloud Wallet did not return a connection code."));
      }
      try {
        await completeCloudWalletConnect(state, code);
        return reply.redirect(cloudWalletReturnUrl("connected"));
      } catch (e) {
        return reply.redirect(cloudWalletReturnUrl("error", (e as Error).message));
      }
    },
  );

  app.post("/v1/wallet/cloud/disconnect", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    await disconnectCloudWallet(session.playerId);
    return cloudWalletPublic(session.playerId);
  });
}
