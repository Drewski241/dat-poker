import type { FastifyInstance } from "fastify";
import { getSiteDatBalance, getSiteDatRedeemed } from "../site-dat-ledger.js";
import { readSiteRedeemConfig } from "../tournament-config.js";
import { redeemSiteDat, siteRedeemMessage, TournamentError, type WalletProof } from "../tournaments.js";

function sendError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof TournamentError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  throw error;
}

export function registerSiteDatRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { address?: string } }>("/v1/wallet/site-dat", async (req, reply) => {
    const address = req.query.address?.trim();
    if (!address) return reply.status(400).send({ error: "address required" });
    const config = readSiteRedeemConfig();
    return {
      address,
      balanceMojos: getSiteDatBalance(address).toString(),
      redeemedMojos: getSiteDatRedeemed(address).toString(),
      redeemEnabled: config.enabled,
      maxRedeemMojos: config.maxMojos.toString(),
      capMojos: config.capMojos.toString(),
      note: config.enabled
        ? "Site DAT is a promotional ledger. It can enter a tournament, and it is not a pool coin."
        : "Site DAT redeems are disabled.",
    };
  });

  app.get<{
    Querystring: { address?: string; amountMojos?: string; nonce?: string };
  }>("/v1/wallet/site-dat/redeem/message", async (req, reply) => {
    const { address, amountMojos, nonce } = req.query;
    if (!address || !amountMojos || !nonce) {
      return reply.status(400).send({ error: "address, amountMojos, and nonce required" });
    }
    try {
      return siteRedeemMessage(address, amountMojos, nonce);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{
    Body: { address?: string; amountMojos?: string; nonce?: string; proof?: WalletProof };
  }>("/v1/wallet/site-dat/redeem", async (req, reply) => {
    const { address, amountMojos, nonce, proof } = req.body ?? {};
    if (!address || !amountMojos || !nonce || !proof) {
      return reply.status(400).send({ error: "address, amountMojos, nonce, and proof required" });
    }
    const config = readSiteRedeemConfig();
    try {
      const result = redeemSiteDat({
        address,
        amountMojos,
        nonce,
        proof,
        enabled: config.enabled,
        maxMojos: config.maxMojos,
        capMojos: config.capMojos,
      });
      return { ok: true, ...result };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
