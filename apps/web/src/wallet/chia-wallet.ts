import SignClient from "@walletconnect/sign-client";
import {
  DAPP_METADATA,
  type ChiaWalletInfo,
  type SignMessageResult,
  type WalletBalance,
  type WcSession,
  parseFingerprint,
  requiredNamespaces,
} from "./constants.js";

let clientPromise: Promise<SignClient> | null = null;

export async function getSignClient(projectId: string): Promise<SignClient> {
  if (!clientPromise) {
    clientPromise = SignClient.init({
      projectId,
      metadata: DAPP_METADATA,
    });
  }
  return clientPromise;
}

export async function beginWalletConnect(params: {
  projectId: string;
  chainId: string;
}): Promise<{ uri: string; approval: () => Promise<WcSession> }> {
  const client = await getSignClient(params.projectId);
  const { uri, approval } = await client.connect({
    requiredNamespaces: requiredNamespaces(params.chainId),
  });
  if (!uri) {
    throw new Error("WalletConnect did not return a pairing URI");
  }
  return { uri, approval };
}

export async function connectWallet(params: {
  projectId: string;
  chainId: string;
}): Promise<{ session: WcSession; uri: string }> {
  const { uri, approval } = await beginWalletConnect(params);
  const session = await approval();
  return { session, uri };
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
): Promise<T> {
  const client = await getSignClient(projectId);
  return client.request<T>({
    topic: session.topic,
    chainId,
    request: { method, params },
  });
}

export function getSessionFingerprint(session: WcSession): number {
  const accounts = session.namespaces.chia?.accounts ?? [];
  if (!accounts.length) {
    throw new Error("No Chia accounts in WalletConnect session");
  }
  const fingerprint = parseFingerprint(accounts[0]);
  if (fingerprint === undefined) {
    throw new Error("Could not parse wallet fingerprint from session");
  }
  return fingerprint;
}

export async function loginSession(
  session: WcSession,
  projectId: string,
  chainId: string,
): Promise<void> {
  const fingerprint = getSessionFingerprint(session);
  await wcRequest(session, projectId, chainId, "chia_logIn", { fingerprint });
}

export async function getWallets(
  session: WcSession,
  projectId: string,
  chainId: string,
): Promise<ChiaWalletInfo[]> {
  const result = await wcRequest<{ wallets: ChiaWalletInfo[] }>(
    session,
    projectId,
    chainId,
    "chia_getWallets",
    { includeData: true },
  );
  return result.wallets ?? (result as unknown as ChiaWalletInfo[]);
}

export async function getWalletBalance(
  session: WcSession,
  projectId: string,
  chainId: string,
  walletId: number,
): Promise<WalletBalance> {
  return wcRequest<WalletBalance>(session, projectId, chainId, "chia_getWalletBalance", {
    walletId,
  });
}

export async function getCurrentAddress(
  session: WcSession,
  projectId: string,
  chainId: string,
  walletId?: number,
): Promise<string> {
  return wcRequest<string>(session, projectId, chainId, "chia_getCurrentAddress", {
    walletId,
  });
}

export async function signBuyInMessage(
  session: WcSession,
  projectId: string,
  chainId: string,
  message: string,
  address: string,
): Promise<SignMessageResult> {
  return wcRequest<SignMessageResult>(session, projectId, chainId, "chia_signMessageByAddress", {
    message,
    address,
  });
}

const CAT_WALLET_TYPE = 6;

export async function findDatCatWallet(
  session: WcSession,
  projectId: string,
  chainId: string,
  assetId: string,
): Promise<{ wallet: ChiaWalletInfo; balance: WalletBalance; address: string }> {
  await loginSession(session, projectId, chainId);
  const wallets = await getWallets(session, projectId, chainId);
  const normalizedAssetId = assetId.toLowerCase();
  const catWallet = wallets.find(
    (w) =>
      w.type === CAT_WALLET_TYPE &&
      w.meta?.assetId?.toLowerCase() === normalizedAssetId,
  );
  if (!catWallet) {
    throw new Error(
      `DAT CAT wallet not found in Sage. Add token asset id ${assetId.slice(0, 8)}… in your wallet.`,
    );
  }
  const balance = await getWalletBalance(session, projectId, chainId, catWallet.id);
  const address = await getCurrentAddress(session, projectId, chainId);
  return { wallet: catWallet, balance, address };
}

export type { WcSession } from "./constants.js";

export function restoreSession(projectId: string): Promise<WcSession | undefined> {
  return getSignClient(projectId).then((client) => {
    const keys = client.session.keys;
    if (!keys.length) return undefined;
    return client.session.get(keys[keys.length - 1]);
  });
}
