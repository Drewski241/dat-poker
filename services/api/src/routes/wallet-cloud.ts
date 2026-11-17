import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CHIA_CLOUD_WALLET_SCOPES,
  createPkceAuthorization,
  exchangeAuthorizationCode,
  listCloudWalletVaults,
  readChiaCloudWalletConfig,
  refreshOAuthTokens,
  revokeOAuthToken,
  takeTreasuryOfferInCloudWallet,
} from "../chia-cloud-wallet.js";
import {
  createCloudWalletSession,
  deleteCloudWalletSession,
  getCloudWalletSession,
  savePendingOAuth,
  takePendingOAuth,
  updateCloudWalletSession,
} from "../cloud-wallet-session-store.js";

const SESSION_COOKIE = "dat_cloud_wallet_sid";

function sessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    maxAge: 7 * 24 * 60 * 60,
  };
}

function getSessionId(req: FastifyRequest): string | undefined {
  const raw = req.cookies?.[SESSION_COOKIE];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

async function sessionWithFreshToken(
  req: FastifyRequest,
): Promise<ReturnType<typeof getCloudWalletSession> | undefined> {
  const config = readChiaCloudWalletConfig();
  const sessionId = getSessionId(req);
  if (!sessionId) return undefined;

  let session = getCloudWalletSession(sessionId);
  if (!session) return undefined;

  if (session.refreshToken && Date.now() >= session.accessExpiresAt - 60_000) {
    try {
      const refreshed = await refreshOAuthTokens({
        config,
        refreshToken: session.refreshToken,
      });
      session =
        updateCloudWalletSession(sessionId, {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? session.refreshToken,
          accessExpiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
        }) ?? session;
    } catch {
      deleteCloudWalletSession(sessionId);
      return undefined;
    }
  }

  return session;
}

export function registerCloudWalletRoutes(app: FastifyInstance): void {
  const config = readChiaCloudWalletConfig();
  const cookieSecure = process.env.CHIA_CLOUD_WALLET_COOKIE_SECURE === "true";

  app.get<{
    Querystring: { returnTo?: string; json?: string };
  }>("/v1/wallet/cloud/connect", async (req, reply) => {
    if (!config.enabled) {
      return reply.status(503).send({
        error: "Chia Cloud Wallet connect is disabled until CHIA_CLOUD_WALLET_CLIENT_ID is set",
      });
    }

    const returnTo = req.query.returnTo?.trim() || config.afterConnectUrl;
    const auth = createPkceAuthorization(config);
    savePendingOAuth({
      state: auth.state,
      codeVerifier: auth.codeVerifier,
      returnTo,
      createdAt: Date.now(),
    });

    if (req.query.json === "1" || req.headers.accept?.includes("application/json")) {
      return {
        authorizeUrl: auth.authorizeUrl,
        scopes: CHIA_CLOUD_WALLET_SCOPES,
        redirectUri: config.redirectUri,
      };
    }

    return reply.redirect(auth.authorizeUrl, 302);
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/v1/wallet/cloud/callback", async (req, reply) => {
    if (!config.enabled) {
      return reply.status(503).send({ error: "Cloud Wallet OAuth is not configured" });
    }

    if (req.query.error) {
      const message = req.query.error_description ?? req.query.error;
      return reply.status(400).send({ error: message });
    }

    const { code, state } = req.query;
    if (!code || !state) {
      return reply.status(400).send({ error: "Missing OAuth code or state" });
    }

    const pending = takePendingOAuth(state);
    if (!pending) {
      return reply.status(400).send({ error: "Invalid or expired OAuth state" });
    }

    try {
      const tokens = await exchangeAuthorizationCode({
        config,
        code,
        codeVerifier: pending.codeVerifier,
      });
      const session = createCloudWalletSession({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresInSec: tokens.expires_in,
      });

      reply.setCookie(SESSION_COOKIE, session.sessionId, sessionCookieOptions(cookieSecure));
      return reply.redirect(pending.returnTo, 302);
    } catch (e) {
      return reply.status(502).send({ error: (e as Error).message });
    }
  });

  app.get("/v1/wallet/cloud/session", async (req, reply) => {
    if (!config.enabled) {
      return { connected: false, enabled: false };
    }

    const session = await sessionWithFreshToken(req);
    if (!session) {
      return { connected: false, enabled: true };
    }

    try {
      const vaults = await listCloudWalletVaults({
        config,
        accessToken: session.accessToken,
      });
      const readyVaults = vaults.filter((v) => v.state === "READY");
      return {
        connected: true,
        enabled: true,
        walletId: session.walletId ?? null,
        vaults: readyVaults,
      };
    } catch (e) {
      return reply.status(502).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: { walletId?: string };
  }>("/v1/wallet/cloud/wallet", async (req, reply) => {
    const sessionId = getSessionId(req);
    if (!sessionId || !getCloudWalletSession(sessionId)) {
      return reply.status(401).send({ error: "Cloud Wallet not connected" });
    }
    const walletId = req.body?.walletId?.trim();
    if (!walletId) {
      return reply.status(400).send({ error: "walletId required" });
    }
    updateCloudWalletSession(sessionId, { walletId });
    return { ok: true, walletId };
  });

  app.post<{
    Body: { offer?: string; feeMojos?: string; walletId?: string };
  }>("/v1/wallet/cloud/take-offer", async (req, reply) => {
    const session = await sessionWithFreshToken(req);
    if (!session) {
      return reply.status(401).send({ error: "Cloud Wallet not connected" });
    }

    const offer = req.body?.offer?.trim();
    if (!offer || !offer.startsWith("offer1")) {
      return reply.status(400).send({ error: "Valid offer string required" });
    }

    const walletId = req.body?.walletId?.trim() ?? session.walletId;
    if (!walletId) {
      return reply.status(400).send({
        error: "Select a Cloud Wallet vault first (walletId)",
      });
    }

    const feeMojos = BigInt(req.body?.feeMojos ?? "0");

    try {
      const result = await takeTreasuryOfferInCloudWallet({
        config,
        accessToken: session.accessToken,
        walletId,
        offer,
        feeMojos,
      });

      const sessionId = getSessionId(req);
      if (sessionId && walletId !== session.walletId) {
        updateCloudWalletSession(sessionId, { walletId });
      }

      return {
        ok: true,
        ...result,
        note: "Treasury payout submitted via Chia Cloud Wallet. Confirm in Cloud Wallet if signing is required.",
      };
    } catch (e) {
      return reply.status(502).send({ error: (e as Error).message });
    }
  });

  app.post("/v1/wallet/cloud/disconnect", async (req, reply) => {
    const sessionId = getSessionId(req);
    if (sessionId) {
      const session = getCloudWalletSession(sessionId);
      if (session?.accessToken && config.enabled) {
        await revokeOAuthToken({ config, token: session.accessToken }).catch(() => undefined);
        if (session.refreshToken) {
          await revokeOAuthToken({ config, token: session.refreshToken }).catch(() => undefined);
        }
      }
      deleteCloudWalletSession(sessionId);
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}