import type { FastifyInstance } from "fastify";
import { allowIpBucket } from "../ip-rate-limit.js";
import { createSessionChallenge, issueSessionFromProof, sessionTtlSeconds } from "../player-session.js";

export function registerSessionRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { address?: string } }>("/v1/session/challenge", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "session-challenge", Date.now(), 40)) {
      return reply.status(429).send({ error: "Too many login challenges from this network" });
    }
    const address = req.query.address?.trim();
    if (!address) {
      return reply.status(400).send({ error: "address required" });
    }
    try {
      const challenge = createSessionChallenge(address);
      return {
        ...challenge,
        ttlSeconds: sessionTtlSeconds(),
        note: "Sage will sign a login message. This cannot send DAT or XCH.",
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: {
      address?: string;
      nonce?: string;
      signature?: string;
      pubkey?: string;
    };
  }>("/v1/session", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "session-create", Date.now(), 40)) {
      return reply.status(429).send({ error: "Too many login attempts from this network" });
    }
    const { address, nonce, signature, pubkey } = req.body ?? {};
    if (!address || !nonce || !signature || !pubkey) {
      return reply.status(400).send({ error: "address, nonce, signature, and pubkey required" });
    }
    try {
      const { token, session } = issueSessionFromProof({
        address,
        nonce,
        signature,
        pubkey,
      });
      return {
        ok: true,
        token,
        playerId: session.playerId,
        address: session.displayAddress,
        expiresInSeconds: sessionTtlSeconds(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
