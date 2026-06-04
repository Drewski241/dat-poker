import SignClient from "@walletconnect/sign-client";
import {
  DAPP_METADATA,
  type AssetBalance,
  type SignMessageResult,
  type WcSession,
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

export async function findDatCatWallet(
  session: WcSession,
  projectId: string,
  chainId: string,
  assetId: string,
): Promise<{ balance: AssetBalance; address: string }> {
  const [address, balance] = await Promise.all([
    getWalletAddress(session, projectId, chainId),
    getDatAssetBalance(session, projectId, chainId, assetId),
  ]);

  if (BigInt(balance.spendable) <= 0n) {
    throw new Error(
      `No spendable DAT balance found. Add CAT asset ${assetId.slice(0, 8)}… in Sage (mainnet).`,
    );
  }

  return { balance, address };
}

export type { WcSession } from "./constants.js";

export function restoreSession(projectId: string): Promise<WcSession | undefined> {
  return getSignClient(projectId).then((client) => {
    const keys = client.session.keys;
    if (!keys.length) return undefined;
    return client.session.get(keys[keys.length - 1]);
  });
}
