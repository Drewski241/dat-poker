import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

/** Shared secret for host ops routes. Empty/unset disables the endpoints. */
export function opsTokenConfigured(): string | null {
  const raw = process.env.DAT_OPS_TOKEN?.trim();
  return raw && raw.length >= 8 ? raw : null;
}

function extractOpsToken(req: FastifyRequest): string | null {
  const header = req.headers["x-dat-ops-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Returns true when the request may access ops routes. */
export function requireOpsAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = opsTokenConfigured();
  if (!expected) {
    void reply.status(503).send({ error: "Ops API disabled — set DAT_OPS_TOKEN (min 8 chars) on the host" });
    return false;
  }
  const got = extractOpsToken(req);
  if (!got || !safeEqual(got, expected)) {
    void reply.status(401).send({ error: "Invalid or missing ops token" });
    return false;
  }
  return true;
}
