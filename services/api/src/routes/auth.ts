import type { FastifyInstance } from "fastify";
import { allowIpBucket } from "../ip-rate-limit.js";
import { issueAccountSession, readPlayerSession, requirePlayer, sessionTtlSeconds } from "../player-session.js";
import {
  changePassword,
  getUserById,
  loginUser,
  publicUser,
  registerUser,
  requestPasswordReset,
  resendEmailVerification,
  resetPasswordWithCode,
  verifyEmailWithCode,
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
    const email = req.body?.email ?? "";
    try {
      const user = await registerUser({ username, password, email });
      return {
        ok: true,
        needsEmailVerification: true,
        message: "Check your email for a verification code, then sign in.",
        ...publicUser(user),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: { username?: string; code?: string };
  }>("/v1/auth/email/verify", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "email-verify", Date.now(), 30)) {
      return reply.status(429).send({ error: "Too many verification attempts from this network" });
    }
    try {
      const user = await verifyEmailWithCode(req.body?.username ?? "", req.body?.code ?? "");
      const { token, session } = issueAccountSession(user);
      return {
        ok: true,
        message: "Email verified. You are signed in.",
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
    Body: { username?: string; email?: string };
  }>("/v1/auth/email/resend", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "email-resend", Date.now(), 8)) {
      return reply.status(429).send({ error: "Too many verification emails from this network" });
    }
    try {
      await resendEmailVerification(req.body?.username ?? "", req.body?.email ?? "");
      return {
        ok: true,
        message: "If that username and email match an unverified account, a new verification code was sent.",
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

  app.post<{
    Body: { username?: string; email?: string };
  }>("/v1/auth/password/forgot", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "password-forgot", Date.now(), 8)) {
      return reply.status(429).send({ error: "Too many password reset requests from this network" });
    }
    try {
      const result = await requestPasswordReset(req.body?.username ?? "", req.body?.email ?? "");
      return {
        ok: true,
        message:
          "If that username and verified email match an account, a reset code was sent by email.",
        ...result,
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: { username?: string; resetCode?: string; password?: string };
  }>("/v1/auth/password/reset", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "password-reset", Date.now(), 20)) {
      return reply.status(429).send({ error: "Too many password reset attempts from this network" });
    }
    try {
      await resetPasswordWithCode(
        req.body?.username ?? "",
        req.body?.resetCode ?? "",
        req.body?.password ?? "",
      );
      return { ok: true, message: "Password updated. Sign in with your new password." };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: { currentPassword?: string; password?: string };
  }>("/v1/auth/password/change", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "password-change", Date.now(), 20)) {
      return reply.status(429).send({ error: "Too many password changes from this network" });
    }
    try {
      await changePassword(session.playerId, req.body?.currentPassword ?? "", req.body?.password ?? "");
      return { ok: true, message: "Password updated." };
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
      emailVerified: false,
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
