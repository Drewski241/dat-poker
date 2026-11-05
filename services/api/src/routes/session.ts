import type { FastifyInstance } from "fastify";
import { allowIpBucket } from "../ip-rate-limit.js";
import {
  createSessionChallenge,
  issueSessionFromProof,
  linkSageToPlayer,
  requirePlayer,
  sessionTtlSeconds,
} from "../player-session.js";
import { recordPlayEligibility, setUserSageLink } from "../user-store.js";
import { assertPlayCompliance, type PlayAttestation } from "../play-compliance.js";
import { assertTermsAccepted, getCurrentTermsDocument } from "../terms-of-service.js";
import { recordTermsAcceptance } from "../terms-acceptance-store.js";

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
    Body: PlayAttestation & {
      address?: string;
      nonce?: string;
      signature?: string;
      pubkey?: string;
      termsAccepted?: boolean;
      termsVersion?: string;
    };
  }>("/v1/session", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "session-create", Date.now(), 40)) {
      return reply.status(429).send({ error: "Too many login attempts from this network" });
    }
    const {
      address,
      nonce,
      signature,
      pubkey,
      countryCode,
      ageConfirmed,
      turnstileToken,
      termsAccepted,
      termsVersion,
    } = req.body ?? {};
    if (!address || !nonce || !signature || !pubkey) {
      return reply.status(400).send({ error: "address, nonce, signature, and pubkey required" });
    }
    try {
      const eligibility = await assertPlayCompliance(req, {
        countryCode,
        ageConfirmed,
        turnstileToken,
      });
      const { token, session } = issueSessionFromProof({
        address,
        nonce,
        signature,
        pubkey,
      });
      await recordPlayEligibility(session.playerId, eligibility.countryCode);
      assertTermsAccepted({ termsAccepted, termsVersion });
      const terms = await getCurrentTermsDocument();
      await recordTermsAcceptance(session.playerId, terms.version);
      return {
        ok: true,
        token,
        playerId: session.playerId,
        address: session.displayAddress,
        expiresInSeconds: sessionTtlSeconds(),
      };
    } catch (e) {
      const msg = (e as Error).message;
      const status = /not available|Bot check|country|legally allowed|Complete the bot|network location|Terms and Conditions|Terms have been updated/i.test(
        msg,
      )
        ? 403
        : 400;
      return reply.status(status).send({ error: msg });
    }
  });

  app.post<{
    Body: {
      address?: string;
      nonce?: string;
      signature?: string;
      pubkey?: string;
    };
  }>("/v1/session/link", async (req, reply) => {
    const current = requirePlayer(req, reply);
    if (!current) return;
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "session-link", Date.now(), 40)) {
      return reply.status(429).send({ error: "Too many Sage link attempts from this network" });
    }
    const { address, nonce, signature, pubkey } = req.body ?? {};
    if (!address || !nonce || !signature || !pubkey) {
      return reply.status(400).send({ error: "address, nonce, signature, and pubkey required" });
    }
    try {
      const { token, session } = linkSageToPlayer(current, {
        address,
        nonce,
        signature,
        pubkey,
      });
      if (session.playerId.startsWith("user_")) {
        await setUserSageLink(session.playerId, session.displayAddress, session.pubkey);
      }
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
