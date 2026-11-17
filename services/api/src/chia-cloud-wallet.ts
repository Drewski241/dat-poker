import { createHash, randomBytes, randomUUID } from "node:crypto";

/** Scopes for DAT withdraw: read vaults, import offers, take treasury payout offers. */
export const CHIA_CLOUD_WALLET_SCOPES =
  "wallet.read offer.read offer.accept offline_access";

export interface ChiaCloudWalletConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  afterConnectUrl: string;
  vaultApiOrigin: string;
  enabled: boolean;
}

export function vaultApiOriginForNetwork(network: string): string {
  return network === "testnet" || network === "testnet11"
    ? "https://api.vault.chiatest.net"
    : "https://api.vault.chia.net";
}

export function readChiaCloudWalletConfig(env: NodeJS.ProcessEnv = process.env): ChiaCloudWalletConfig {
  const clientId = env.CHIA_CLOUD_WALLET_CLIENT_ID?.trim() ?? "";
  const network = env.CHIA_NETWORK ?? "mainnet";
  const vaultApiOrigin = vaultApiOriginForNetwork(network);

  const redirectUri =
    env.CHIA_CLOUD_WALLET_REDIRECT_URI?.trim() ??
    `http://localhost:${env.API_PORT ?? "4000"}/v1/wallet/cloud/callback`;

  const afterConnectUrl =
    env.CHIA_CLOUD_WALLET_AFTER_CONNECT_URL?.trim() ?? "http://localhost:5173/";

  const clientSecret = env.CHIA_CLOUD_WALLET_CLIENT_SECRET?.trim() || undefined;

  return {
    clientId,
    clientSecret,
    redirectUri,
    afterConnectUrl,
    vaultApiOrigin,
    enabled: Boolean(clientId),
  };
}

export interface PkceAuthorization {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  authorizeUrl: string;
}

export function createPkceAuthorization(config: ChiaCloudWalletConfig): PkceAuthorization {
  const state = randomUUID();
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const authorizeUrl = new URL(`${config.vaultApiOrigin}/authorize`);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", CHIA_CLOUD_WALLET_SCOPES);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  return { state, codeVerifier, codeChallenge, authorizeUrl: authorizeUrl.toString() };
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeAuthorizationCode(params: {
  config: ChiaCloudWalletConfig;
  code: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", params.config.clientId);
  body.set("code", params.code);
  body.set("redirect_uri", params.config.redirectUri);
  body.set("code_verifier", params.codeVerifier);
  if (params.config.clientSecret) {
    body.set("client_secret", params.config.clientSecret);
  }

  const res = await fetch(`${params.config.vaultApiOrigin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json()) as OAuthTokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(json.error_description ?? json.error ?? `Token exchange failed (${res.status})`);
  }
  if (!json.access_token) {
    throw new Error("Token response missing access_token");
  }
  return json;
}

export async function refreshOAuthTokens(params: {
  config: ChiaCloudWalletConfig;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("client_id", params.config.clientId);
  body.set("refresh_token", params.refreshToken);
  if (params.config.clientSecret) {
    body.set("client_secret", params.config.clientSecret);
  }

  const res = await fetch(`${params.config.vaultApiOrigin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json()) as OAuthTokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(json.error_description ?? json.error ?? `Token refresh failed (${res.status})`);
  }
  if (!json.access_token) {
    throw new Error("Refresh response missing access_token");
  }
  return json;
}

export async function revokeOAuthToken(params: {
  config: ChiaCloudWalletConfig;
  token: string;
}): Promise<void> {
  const body = new URLSearchParams();
  body.set("client_id", params.config.clientId);
  body.set("token", params.token);

  await fetch(`${params.config.vaultApiOrigin}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

interface GraphQlEnvelope<T> {
  data?: T;
  errors?: { message: string }[];
}

export async function cloudWalletGraphql<T>(params: {
  config: ChiaCloudWalletConfig;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}): Promise<T> {
  const res = await fetch(`${params.config.vaultApiOrigin}/graphql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: params.query,
      variables: params.variables,
      operationName: params.operationName,
    }),
  });

  const json = (await res.json()) as GraphQlEnvelope<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("GraphQL response missing data");
  }
  return json.data;
}

export interface CloudWalletVaultSummary {
  id: string;
  name: string;
  state: string;
}

export async function listCloudWalletVaults(params: {
  config: ChiaCloudWalletConfig;
  accessToken: string;
}): Promise<CloudWalletVaultSummary[]> {
  const data = await cloudWalletGraphql<{
    viewer: {
      wallets: {
        edges: { node: CloudWalletVaultSummary }[];
      } | null;
    } | null;
  }>({
    config: params.config,
    accessToken: params.accessToken,
    query: `query ListVaults {
      viewer {
        wallets(first: 20) {
          edges {
            node {
              id
              name
              state
            }
          }
        }
      }
    }`,
  });

  return data.viewer?.wallets?.edges.map((e) => e.node) ?? [];
}

export interface TakeOfferResult {
  offerId: string;
  signatureRequestId: string;
  signatureRequestStatus: string;
}

/** Import a treasury offer string and take it in the player's Cloud Wallet vault. */
export async function takeTreasuryOfferInCloudWallet(params: {
  config: ChiaCloudWalletConfig;
  accessToken: string;
  walletId: string;
  offer: string;
  feeMojos: bigint;
}): Promise<TakeOfferResult> {
  const importData = await cloudWalletGraphql<{
    addOffer: {
      offer: {
        offerId: string;
        state: string;
      } | null;
    } | null;
  }>({
    config: params.config,
    accessToken: params.accessToken,
    query: `mutation ImportOffer($input: AddOfferInput!) {
      addOffer(input: $input) {
        offer {
          offerId
          state
        }
      }
    }`,
    variables: {
      input: {
        walletId: params.walletId,
        offer: params.offer,
      },
    },
  });

  const offerId = importData.addOffer?.offer?.offerId;
  if (!offerId) {
    throw new Error("Cloud Wallet did not return an offer id after import");
  }

  const takeData = await cloudWalletGraphql<{
    takeOffer: {
      signatureRequest: {
        id: string;
        status: string;
      } | null;
    } | null;
  }>({
    config: params.config,
    accessToken: params.accessToken,
    query: `mutation TakeOffer($input: TakeOfferInput!) {
      takeOffer(input: $input) {
        signatureRequest {
          id
          status
        }
      }
    }`,
    variables: {
      input: {
        walletId: params.walletId,
        offerId,
        fee: params.feeMojos.toString(),
        autoSubmit: true,
      },
    },
  });

  const sig = takeData.takeOffer?.signatureRequest;
  if (!sig) {
    throw new Error("Cloud Wallet takeOffer did not return a signature request");
  }

  return {
    offerId,
    signatureRequestId: sig.id,
    signatureRequestStatus: sig.status,
  };
}