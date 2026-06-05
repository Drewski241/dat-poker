import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import https from "node:https";
import { URL } from "node:url";

export type TreasuryWalletBackend = "sage" | "chia";

export interface TreasuryWalletRpcConfig {
  backend: TreasuryWalletBackend;
  url: string;
  certPath?: string;
  keyPath?: string;
  rejectUnauthorized?: boolean;
  sageFingerprint?: number;
}

export interface SageMakeOfferResponse {
  offer?: string;
  success?: boolean;
  error?: string;
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

export function defaultSageCertPaths(): { certPath?: string; keyPath?: string } {
  const candidates = [
    join(homedir(), ".local/share/sage/ssl"),
    join(homedir(), ".local/share/com.rigidnetwork.sage/ssl"),
    join(homedir(), "Library/Application Support/com.rigidnetwork.sage/ssl"),
  ];

  for (const dir of candidates) {
    const certPath = join(dir, "wallet.crt");
    const keyPath = join(dir, "wallet.key");
    if (existsSync(certPath) && existsSync(keyPath)) {
      return { certPath, keyPath };
    }
  }
  return {};
}

export function readTreasuryWalletRpcConfigFromEnv(): TreasuryWalletRpcConfig {
  const backend = process.env.TREASURY_WALLET_BACKEND === "chia" ? "chia" : "sage";
  const defaults = backend === "sage" ? defaultSageCertPaths() : {};
  const fingerprintRaw = process.env.TREASURY_SAGE_FINGERPRINT?.trim();

  return {
    backend,
    url:
      process.env.TREASURY_WALLET_RPC_URL?.trim() ||
      (backend === "sage" ? "https://127.0.0.1:9257" : "https://127.0.0.1:9256"),
    certPath: expandWalletPath(process.env.TREASURY_WALLET_CERT_PATH) ?? defaults.certPath,
    keyPath: expandWalletPath(process.env.TREASURY_WALLET_KEY_PATH) ?? defaults.keyPath,
    rejectUnauthorized:
      backend === "sage"
        ? process.env.TREASURY_WALLET_INSECURE === "true"
          ? false
          : false
        : process.env.TREASURY_WALLET_INSECURE !== "true",
    sageFingerprint: fingerprintRaw ? Number(fingerprintRaw) : undefined,
  };
}

/** @deprecated use readTreasuryWalletRpcConfigFromEnv */
export function readWalletRpcConfigFromEnv(): TreasuryWalletRpcConfig {
  return readTreasuryWalletRpcConfigFromEnv();
}

function buildAgent(config: TreasuryWalletRpcConfig): https.Agent {
  if (config.certPath && config.keyPath) {
    return new https.Agent({
      cert: readFileSync(config.certPath),
      key: readFileSync(config.keyPath),
      rejectUnauthorized: config.rejectUnauthorized ?? false,
    });
  }
  return new https.Agent({
    rejectUnauthorized: config.rejectUnauthorized ?? false,
  });
}

export async function treasuryWalletRpcRequest<T>(
  config: TreasuryWalletRpcConfig,
  method: string,
  params: Record<string, unknown> = {},
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
            reject(
              new Error(`Treasury wallet RPC invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`),
            );
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

export async function pingTreasuryWalletRpc(config: TreasuryWalletRpcConfig): Promise<boolean> {
  try {
    if (config.backend === "sage") {
      await treasuryWalletRpcRequest(config, "get_sync_status", {});
    } else {
      await treasuryWalletRpcRequest(config, "get_routes", {});
    }
    return true;
  } catch {
    return false;
  }
}

export async function ensureSageTreasuryLoggedIn(config: TreasuryWalletRpcConfig): Promise<void> {
  if (config.backend !== "sage" || !config.sageFingerprint) {
    return;
  }
  await treasuryWalletRpcRequest(config, "login", { fingerprint: config.sageFingerprint });
}
