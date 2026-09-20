import type { FastifyInstance } from "fastify";
import { allowIpBucket } from "../ip-rate-limit.js";
import { issueAccountSession, readPlayerSession, requirePlayer, sessionTtlSeconds } from "../player-session.js";
import {
  attachEmailToAccount,
  changePassword,
  getUserById,
  loginUser,
  publicUser,
  recordPlayEligibility,
  registerUser,
  requestPasswordReset,
  resendEmailVerification,
  resetPasswordWithCode,
  verifyEmailWithCode,
} from "../user-store.js";
import {
  assertPlayCompliance,
  readPlayRequirements,
  resolveIpCountry,
  type PlayAttestation,
} from "../play-compliance.js";
import { assertTermsAccepted, getCurrentTermsDocument } from "../terms-of-service.js";
import { recordTermsAcceptance } from "../terms-acceptance-store.js";
import { emailBetaRevealCodeInApi, emailDeliversToInbox } from "../mail.js";

type AuthComplianceBody = PlayAttestation & {
  termsAccepted?: boolean;
  termsVersion?: string;
};

async function enforceTermsAndRecord(playerId: string, body: AuthComplianceBody | undefined): Promise<void> {
  assertTermsAccepted({
    termsAccepted: body?.termsAccepted,
    termsVersion: body?.termsVersion,
  });
  const terms = await getCurrentTermsDocument();
  await recordTermsAcceptance(playerId, terms.version);
}

function readAttestation(body: AuthComplianceBody | undefined): PlayAttestation {
  return {
    countryCode: body?.countryCode,
    ageConfirmed: body?.ageConfirmed,
    turnstileToken: body?.turnstileToken,
  };
}

function verificationUserMessage(): string {
  if (emailDeliversToInbox()) {
    return "Check your email for a verification code, then sign in.";
  }
  return "This server is not sending email to inboxes yet (SMTP not configured). The operator can read the code from the API server log, or set DAT_SMTP_* on the host.";
}

function betaVerificationFields(code: string | undefined): { betaVerificationCode?: string } {
  if (!emailBetaRevealCodeInApi() || !code) return {};
  return { betaVerificationCode: code };
}

function complianceErrorStatus(message: string): 400 | 403 {
  return /not available|Bot check|country|legally allowed|Complete the bot|network location|Terms and Conditions|Terms have been updated/i.test(
    message,
  )
    ? 403
    : 400;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/v1/auth/play-requirements", async () => {
    const req = readPlayRequirements();
    return { ok: true, ...req };
  });

  app.get("/v1/auth/geo-hint", async (req) => {
    const countryCode = resolveIpCountry(req);
    return { ok: true, countryCode };
  });

  app.get("/v1/auth/terms", async () => {
    const terms = await getCurrentTermsDocument();
    return { ok: true, ...terms };
  });
  app.post<{
    Body: AuthComplianceBody & { username?: string; password?: string; email?: string };
  }>("/v1/auth/register", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "register", Date.now(), 12)) {
      return reply.status(429).send({ error: "Too many accounts created from this network" });
    }
    const username = req.body?.username ?? "";
    const password = req.body?.password ?? "";
    const email = req.body?.email ?? "";
    try {
      const eligibility = await assertPlayCompliance(req, readAttestation(req.body));
      assertTermsAccepted({
        termsAccepted: req.body?.termsAccepted,
        termsVersion: req.body?.termsVersion,
      });
      const { user, verificationCode } = await registerUser({ username, password, email });
      await recordPlayEligibility(user.id, eligibility.countryCode);
      const terms = await getCurrentTermsDocument();
      await recordTermsAcceptance(user.id, terms.version);
      return {
        ok: true,
        needsEmailVerification: true,
        message: verificationUserMessage(),
        ...publicUser(user),
        ...betaVerificationFields(verificationCode),
      };
    } catch (e) {
      const msg = (e as Error).message;
      return reply.status(complianceErrorStatus(msg)).send({ error: msg });
    }
  });

  app.post<{
    Body: AuthComplianceBody & { username?: string; code?: string };
  }>("/v1/auth/email/verify", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "email-verify", Date.now(), 30)) {
      return reply.status(429).send({ error: "Too many verification attempts from this network" });
    }
    try {
      const eligibility = await assertPlayCompliance(req, readAttestation(req.body));
      const user = await verifyEmailWithCode(req.body?.username ?? "", req.body?.code ?? "");
      await recordPlayEligibility(user.id, eligibility.countryCode);
      const { token, session } = issueAccountSession(user);
      await enforceTermsAndRecord(session.playerId, req.body);
      return {
        ok: true,
        message: "Email verified. You are signed in.",
        token,
        ...publicUser(user),
        playerId: session.playerId,
        expiresInSeconds: sessionTtlSeconds(),
      };
    } catch (e) {
      const msg = (e as Error).message;
      return reply.status(complianceErrorStatus(msg)).send({ error: msg });
    }
  });

  app.post<{
    Body: AuthComplianceBody & { username?: string; password?: string; email?: string };
  }>("/v1/auth/email/add", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "email-add", Date.now(), 12)) {
      return reply.status(429).send({ error: "Too many requests from this network" });
    }
    try {
      await assertPlayCompliance(req, readAttestation(req.body));
      assertTermsAccepted({
        termsAccepted: req.body?.termsAccepted,
        termsVersion: req.body?.termsVersion,
      });
      const { user, verificationCode } = await attachEmailToAccount({
        username: req.body?.username ?? "",
        password: req.body?.password ?? "",
        email: req.body?.email ?? "",
      });
      const terms = await getCurrentTermsDocument();
      await recordTermsAcceptance(user.id, terms.version);
      return {
        ok: true,
        needsEmailVerification: true,
        message: verificationUserMessage(),
        ...publicUser(user),
        ...betaVerificationFields(verificationCode),
      };
    } catch (e) {
      const msg = (e as Error).message;
      return reply.status(complianceErrorStatus(msg)).send({ error: msg });
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
      const result = await resendEmailVerification(req.body?.username ?? "", req.body?.email ?? "");
      return {
        ok: true,
        message: result.sent
          ? verificationUserMessage()
          : "If that username and email match an unverified account, a new verification code was sent.",
        ...betaVerificationFields(result.verificationCode),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: AuthComplianceBody & { username?: string; password?: string };
  }>("/v1/auth/login", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!allowIpBucket(ip, "login", Date.now(), 30)) {
      return reply.status(429).send({ error: "Too many sign-in attempts from this network" });
    }
    try {
      const eligibility = await assertPlayCompliance(req, readAttestation(req.body));
      const user = await loginUser(req.body?.username ?? "", req.body?.password ?? "");
      await recordPlayEligibility(user.id, eligibility.countryCode);
      const { token, session } = issueAccountSession(user);
      await enforceTermsAndRecord(session.playerId, req.body);
      return {
        ok: true,
        token,
        ...publicUser(user),
        playerId: session.playerId,
        expiresInSeconds: sessionTtlSeconds(),
      };
    } catch (e) {
      const msg = (e as Error).message;
      const status = complianceErrorStatus(msg);
      return reply.status(status).send({ error: msg });
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
