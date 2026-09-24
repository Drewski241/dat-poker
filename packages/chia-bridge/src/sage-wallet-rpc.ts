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

export function sageCertSearchDirs(): string[] {
  const homes = new Set<string>();
  homes.add(homedir());
  if (process.env.HOME) homes.add(process.env.HOME);
  if (process.env.TREASURY_SAGE_HOME) homes.add(process.env.TREASURY_SAGE_HOME);
  homes.add("/home/ec2-user");
  homes.add("/root");

  const dirs: string[] = [];
  for (const home of homes) {
    dirs.push(join(home, ".local/share/sage/ssl"));
    dirs.push(join(home, ".local/share/com.rigidnetwork.sage/ssl"));
    dirs.push(join(home, "Library/Application Support/com.rigidnetwork.sage/ssl"));
  }
  dirs.push("/opt/dat-poker/data/sage/ssl");
  dirs.push("/opt/sage/ssl");
  dirs.push("/var/lib/sage/ssl");
  return [...new Set(dirs)];
}

export function defaultSageCertPaths(): { certPath?: string; keyPath?: string } {
  for (const dir of sageCertSearchDirs()) {
    const certPath = join(dir, "wallet.crt");
    const keyPath = join(dir, "wallet.key");
    if (existsSync(certPath) && existsSync(keyPath)) {
      return { certPath, keyPath };
    }
  }
  return {};
}

export function describeMissingSageCerts(): string {
  return (
    "Sage RPC certs (wallet.crt / wallet.key) were not found for the treasury process. " +
    "Treasury HTTP is up, but it cannot talk to Sage on :9257. " +
    "On the AWS host run: sudo bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh"
  );
}

export function describeSageLoginNeeded(fingerprintSet: boolean): string {
  if (fingerprintSet) {
    return (
      "Sage RPC certs are present but the treasury key is not logged in. " +
      "On the AWS host: sudo TREASURY_SAGE_FINGERPRINT=<id> bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh"
    );
  }
  return (
    "Sage RPC certs are present, but no treasury key is imported (sageFingerprint is null). " +
    "This is a dedicated host key, not the player Sage. Create or import it: " +
    "sudo SAGE_CREATE_KEY=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh " +
    "or sudo TREASURY_SAGE_MNEMONIC='word word …' bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh"
  );
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
    req.setTimeout(12_000, () => {
      req.destroy();
      reject(new Error("Treasury Sage RPC timed out waiting for an offer"));
    });
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
