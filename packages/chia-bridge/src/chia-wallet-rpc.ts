import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import https from "node:https";
import { URL } from "node:url";

export interface ChiaWalletRpcConfig {
  url: string;
  certPath?: string;
  keyPath?: string;
  rejectUnauthorized?: boolean;
}

export interface CreateOfferForIdsResponse {
  success: boolean;
  offer?: string;
  error?: string;
}

export function expandWalletPath(path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined;
  const trimmed = path.trim();
  if (trimmed.startsWith("~/")) {
    return `${homedir()}${trimmed.slice(1)}`;
  }
  return trimmed;
}

export function readWalletRpcConfigFromEnv(): ChiaWalletRpcConfig {
  return {
    url: process.env.TREASURY_WALLET_RPC_URL?.trim() || "https://127.0.0.1:9256",
    certPath: expandWalletPath(process.env.TREASURY_WALLET_CERT_PATH),
    keyPath: expandWalletPath(process.env.TREASURY_WALLET_KEY_PATH),
    rejectUnauthorized: process.env.TREASURY_WALLET_INSECURE !== "true",
  };
}

function buildAgent(config: ChiaWalletRpcConfig): https.Agent {
  if (config.certPath && config.keyPath) {
    return new https.Agent({
      cert: readFileSync(config.certPath),
      key: readFileSync(config.keyPath),
      rejectUnauthorized: config.rejectUnauthorized ?? true,
    });
  }
  return new https.Agent({
    rejectUnauthorized: config.rejectUnauthorized ?? false,
  });
}

export async function walletRpcRequest<T>(
  config: ChiaWalletRpcConfig,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`/${method}`, config.url.endsWith("/") ? config.url : `${config.url}/`);
  const body = JSON.stringify(params);
  const agent = buildAgent(config);

  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        agent,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: T & { success?: boolean; error?: string };
          try {
            parsed = JSON.parse(text) as T & { success?: boolean; error?: string };
          } catch {
            reject(new Error(`Treasury wallet RPC invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.error ?? `Treasury wallet RPC HTTP ${res.statusCode}`));
            return;
          }
          if (parsed.success === false) {
            reject(new Error(parsed.error ?? "Treasury wallet RPC failed"));
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function pingWalletRpc(config: ChiaWalletRpcConfig): Promise<boolean> {
  try {
    await walletRpcRequest<{ success: boolean; routes?: string[] }>(config, "get_routes", {});
    return true;
  } catch {
    return false;
  }
}
