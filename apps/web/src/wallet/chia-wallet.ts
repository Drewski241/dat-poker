import SignClient from "@walletconnect/sign-client";
import {
  WALLETCONNECT_RELAY_URL,
  type AssetBalance,
  type SignMessageResult,
  type WcSession,
  dappMetadata,
  optionalNamespaces,
  requiredNamespaces,
  SAGE_DRAIN_METHODS,
  SAGE_TAKE_OFFER_METHOD,
  sessionCanTakeOffer,
  sessionDrainMethods,
} from "./constants.js";
import { DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS } from "@dat-poker/shared";
import { isMobileUserAgent } from "./wc-link.js";

let clientPromise: Promise<SignClient> | null = null;

function relayerWaitMs(): number {
  return isMobileUserAgent() ? 22_000 : 12_000;
}

type DisplayUriClient = {
  on(event: "display_uri", listener: (uri: string) => void): void;
  off(event: "display_uri", listener: (uri: string) => void): void;
};

export function resetSignClient(): void {
  clientPromise = null;
}

export function mapWalletConnectError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://datspiritpoker.com";
  const publishFailed =
    lower.includes("publish") ||
    lower.includes("tag:undefined") ||
    lower.includes("socket stalled") ||
    lower.includes("relay") ||
    lower.includes("websocket");
  if (publishFailed) {
    return new Error(
      `${raw} WalletConnect could not publish the pairing to the Reown relay, so no QR was created. In Reown Cloud → your DAT Poker project → Allowed domains, add ${origin} (and https://www.datspiritpoker.com if you use www), then click Connect Sage again.`,
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

async function waitForRelayer(client: SignClient, timeoutMs = relayerWaitMs()): Promise<void> {
  const relayer = client.core.relayer;
  if (relayer.connected) return;

  const ready = (async () => {
    if (!relayer.connected && !relayer.connecting) {
      await relayer.transportOpen(WALLETCONNECT_RELAY_URL);
    }
    await relayer.confirmOnlineStateOrThrow();
  })();

  await Promise.race([
    ready,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            "WalletConnect relay timed out before a QR could be created. Check that this site is on the Reown Cloud domain allowlist, then try again.",
          ),
        );
      }, timeoutMs);
      void ready.finally(() => clearTimeout(timer));
    }),
  ]);
}

async function dropInactivePairings(client: SignClient): Promise<void> {
  const pairings = client.core.pairing.getPairings();
  await Promise.all(
    pairings
      .filter((pairing) => !pairing.active)
      .map(async (pairing) => {
        try {
          await client.core.pairing.disconnect({ topic: pairing.topic });
        } catch {
          /* leftover IndexedDB pairings from a failed QR attempt */
        }
      }),
  );
}

export async function getSignClient(projectId: string): Promise<SignClient> {
  if (!clientPromise) {
    clientPromise = SignClient.init({
      projectId,
      metadata: dappMetadata(),
      relayUrl: WALLETCONNECT_RELAY_URL,
    })
      .then(async (client) => {
        await waitForRelayer(client);
        return client;
      })
      .catch((err: unknown) => {
        clientPromise = null;
        throw mapWalletConnectError(err);
      });
  }
  const client = await clientPromise;
  await waitForRelayer(client);
  return client;
}

async function proposeSession(
  client: SignClient,
  chainId: string,
  onUri?: (uri: string) => void,
): Promise<{ uri: string; approval: () => Promise<WcSession> }> {
  let uriFromEvent: string | undefined;
  const onDisplayUri = (uri: string) => {
    uriFromEvent = uri;
    onUri?.(uri);
  };
  const events = client as unknown as DisplayUriClient;
  events.on("display_uri", onDisplayUri);
  try {
    const { uri, approval } = await client.connect({
      requiredNamespaces: requiredNamespaces(chainId),
      optionalNamespaces: optionalNamespaces(chainId),
    });
    const pairingUri = uri ?? uriFromEvent;
    if (!pairingUri) {
      throw new Error("WalletConnect did not return a pairing URI");
    }
    onUri?.(pairingUri);
    return { uri: pairingUri, approval };
  } finally {
    events.off("display_uri", onDisplayUri);
  }
}

export async function beginWalletConnect(params: {
  projectId: string;
  chainId: string;
  onUri?: (uri: string) => void;
}): Promise<{ uri: string; approval: () => Promise<WcSession> }> {
  const client = await getSignClient(params.projectId);
  await dropInactivePairings(client);

  try {
    return await proposeSession(client, params.chainId, params.onUri);
  } catch (first) {
    try {
      await client.core.relayer.restartTransport(WALLETCONNECT_RELAY_URL);
    } catch {
      /* ignore */
    }
    try {
      await waitForRelayer(client);
      return await proposeSession(client, params.chainId, params.onUri);
    } catch (second) {
      resetSignClient();
      throw mapWalletConnectError(second instanceof Error ? second : first);
    }
  }
}

export async function disconnectWallet(session: WcSession, projectId: string): Promise<void> {
  const client = await getSignClient(projectId);
  await client.disconnect({
    topic: session.topic,
    reason: { code: 6000, message: "User disconnected" },
  });
}

async function wcRequest<T>(
  session: WcSession,
  projectId: string,
  chainId: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 90_000,
): Promise<T> {
  const client = await getSignClient(projectId);
  if ((SAGE_DRAIN_METHODS as readonly string[]).includes(method)) {
    throw new Error(
      "This site does not send DAT or XCH from Sage. Treasury withdraw only asks you to accept a DAT offer.",
    );
  }
  const request = client.request<T>({
    topic: session.topic,
    chainId,
    request: { method, params },
  });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out waiting for Sage (${method}). Open the Sage app and approve the request.`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function utf8ToHex(message: string): string {
  return [...new TextEncoder().encode(message)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signWithChip0002(
  session: WcSession,
  projectId: string,
  chainId: string,
  message: string,
): Promise<SignMessageResult> {
  const publicKeys = await wcRequest<string[]>(
    session,
    projectId,
    chainId,
    "chip0002_getPublicKeys",
    {},
  );
  const publicKey = publicKeys[0];
  if (!publicKey) {
    throw new Error("Sage did not return a public key");
  }
  const signature = await wcRequest<string>(session, projectId, chainId, "chip0002_signMessage", {
    message: utf8ToHex(message),
    publicKey,
  });
  return { pubkey: publicKey, signature };
}

async function signWithAddress(
  session: WcSession,
  projectId: string,
  chainId: string,
  message: string,
  address: string,
): Promise<SignMessageResult> {
  const result = await wcRequest<{ publicKey?: string; pubkey?: string; signature: string }>(
    session,
    projectId,
    chainId,
    "chia_signMessageByAddress",
    { message, address },
  );
  const pubkey = result.publicKey ?? result.pubkey;
  if (!pubkey) {
    throw new Error("Wallet did not return a public key for signed message");
  }
  return { pubkey, signature: result.signature };
}

export async function getWalletAddress(
  session: WcSession,
  projectId: string,
  chainId: string,
): Promise<string> {
  const result = await wcRequest<{ address: string }>(
    session,
    projectId,
    chainId,
    "chia_getAddress",
    {},
  );
  return result.address;
}

export async function getDatAssetBalance(
  session: WcSession,
  projectId: string,
  chainId: string,
  assetId: string,
): Promise<AssetBalance> {
  return wcRequest<AssetBalance>(session, projectId, chainId, "chip0002_getAssetBalance", {
    type: "cat",
    assetId,
  });
}

export async function signBuyInMessage(
  session: WcSession,
  projectId: string,
  chainId: string,
  message: string,
  address: string,
): Promise<SignMessageResult> {
  try {
    return await signWithAddress(session, projectId, chainId, message, address);
  } catch (addressErr) {
    try {
      return await signWithChip0002(session, projectId, chainId, message);
    } catch {
      throw addressErr;
    }
  }
}

export function isChiaOfferString(offer: string): boolean {
  return /^offer1[a-z0-9]+$/i.test(offer.trim());
}

export async function takeOffer(
  session: WcSession,
  projectId: string,
  chainId: string,
  offer: string,
  feeMojos = DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS,
): Promise<{ success: boolean }> {
  const trimmed = offer.trim();
  if (!isChiaOfferString(trimmed)) {
    throw new Error("That is not a Chia offer1 string.");
  }
  if (!sessionCanTakeOffer(session)) {
    throw new Error(
      "This Sage pairing cannot show the Accept popup. Disconnect, Connect Sage again, then withdraw — or import the offer (Offers → Import).",
    );
  }
  const fee = Number(feeMojos);
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error("Invalid take-offer fee");
  }
  const result = await wcRequest<{ success?: boolean }>(
    session,
    projectId,
    chainId,
    SAGE_TAKE_OFFER_METHOD,
    { offer: trimmed, fee },
    120_000,
  );
  return { success: result.success !== false };
}

export async function loadPlayerWallet(
  session: WcSession,
  projectId: string,
  chainId: string,
  assetId?: string | null,
): Promise<{ balance: AssetBalance; address: string }> {
  const address = await getWalletAddress(session, projectId, chainId);
  let balance: AssetBalance = { confirmed: "0", spendable: "0", spendableCoinCount: 0 };
  if (assetId) {
    try {
      balance = await getDatAssetBalance(session, projectId, chainId, assetId);
    } catch {
      /* CAT may not be added yet — daily redeem funds the table account */
    }
  }
  return { balance, address };
}

export async function findDatCatWallet(
  session: WcSession,
  projectId: string,
  chainId: string,
  assetId: string,
): Promise<{ balance: AssetBalance; address: string }> {
  return loadPlayerWallet(session, projectId, chainId, assetId);
}

export type { WcSession } from "./constants.js";
export { sessionCanTakeOffer } from "./constants.js";

export const signWithdrawMessage = signBuyInMessage;
export const signRedeemMessage = signBuyInMessage;

export function restoreSession(projectId: string): Promise<WcSession | undefined> {
  return getSignClient(projectId).then(async (client) => {
    const keys = client.session.keys;
    if (!keys.length) return undefined;
    const session = client.session.get(keys[keys.length - 1]);
    const drains = sessionDrainMethods(session);
    if (drains.length) {
      try {
        await client.disconnect({
          topic: session.topic,
          reason: { code: 6000, message: "Send/create-offer methods are not allowed on DAT Poker beta" },
        });
      } catch {
        /* still refuse to reuse a drain-capable session */
      }
      return undefined;
    }
    return session;
  });
}
