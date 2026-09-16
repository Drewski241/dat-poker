import type { FastifyInstance } from "fastify";
import { allowIpBucket } from "../ip-rate-limit.js";
import { issueAccountSession, readPlayerSession, requirePlayer, sessionTtlSeconds } from "../player-session.js";
import {
  getUserById,
  loginUser,
  publicUser,
  registerUser,
} from "../user-store.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post<{
    Body: { username?: string; password?: string; email?: string };
  }>("/v1/auth/register", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "register", Date.now(), 12)) {
      return reply.status(429).send({ error: "Too many accounts created from this network" });
    }
    const username = req.body?.username ?? "";
    const password = req.body?.password ?? "";
    const email = req.body?.email;
    try {
      const user = await registerUser({ username, password, email });
      const { token, session } = issueAccountSession(user);
      return {
        ok: true,
        token,
        ...publicUser(user),
        playerId: session.playerId,
        expiresInSeconds: sessionTtlSeconds(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: { username?: string; password?: string };
  }>("/v1/auth/login", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "login", Date.now(), 30)) {
      return reply.status(429).send({ error: "Too many sign-in attempts from this network" });
    }
    try {
      const user = await loginUser(req.body?.username ?? "", req.body?.password ?? "");
      const { token, session } = issueAccountSession(user);
      return {
        ok: true,
        token,
        ...publicUser(user),
        playerId: session.playerId,
        expiresInSeconds: sessionTtlSeconds(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.get("/v1/auth/me", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const user = await getUserById(session.playerId);
    if (user) {
      return { ok: true, ...publicUser(user), expiresInSeconds: sessionTtlSeconds() };
    }
    return {
      ok: true,
      playerId: session.playerId,
      username: session.displayAddress,
      email: "",
      sageLinked: Boolean(session.pubkey),
      sageAddress: session.pubkey ? session.displayAddress : "",
      expiresInSeconds: sessionTtlSeconds(),
    };
  });

  app.get("/v1/session/me", async (req, reply) => {
    const session = readPlayerSession(req);
    if (!session) {
      return reply.status(401).send({ error: "Not signed in" });
    }
    return {
      playerId: session.playerId,
      displayAddress: session.displayAddress,
      sageLinked: Boolean(session.pubkey),
    };
  });
}
