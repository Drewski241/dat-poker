import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultSageCertPaths,
  pingTreasuryWalletRpc,
  readTreasuryWalletRpcConfigFromEnv,
  treasuryWalletRpcRequest,
} from "@dat-poker/chia-bridge";
import { readTreasuryServiceConfig } from "./payout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

type CheckResult = { ok: boolean; label: string; detail?: string };

function pass(label: string, detail?: string): CheckResult {
  return { ok: true, label, detail };
}

function fail(label: string, detail?: string): CheckResult {
  return { ok: false, label, detail };
}

function printResults(title: string, results: CheckResult[]): boolean {
  console.log(`\n${title}`);
  for (const r of results) {
    const icon = r.ok ? "✓" : "✗";
    const line = r.detail ? `${r.label} — ${r.detail}` : r.label;
    console.log(`  ${icon} ${line}`);
  }
  return results.every((r) => r.ok);
}

async function main(): Promise<void> {
  console.log("DAT Poker — treasury host setup check");
  console.log("Run this on the machine where treasury Sage + dev:treasury live.\n");

  const config = readTreasuryServiceConfig();
  const rpc = readTreasuryWalletRpcConfigFromEnv();

  const envChecks: CheckResult[] = [];
  if (config.defaultAssetId) {
    envChecks.push(pass("DAT_GOVERNANCE_TOKEN_ASSET_ID set", config.defaultAssetId.slice(0, 16) + "…"));
  } else {
    envChecks.push(fail("DAT_GOVERNANCE_TOKEN_ASSET_ID missing"));
  }

  if (config.offerMode === "rpc") {
    envChecks.push(pass("TREASURY_OFFER_MODE=rpc"));
  } else {
    envChecks.push(
      fail("TREASURY_OFFER_MODE=mock", "Set TREASURY_OFFER_MODE=rpc for real payouts on treasury host"),
    );
  }

  if (rpc.backend === "sage") {
    envChecks.push(pass("TREASURY_WALLET_BACKEND=sage"));
  } else {
    envChecks.push(fail("TREASURY_WALLET_BACKEND is not sage"));
  }

  if (rpc.url.includes("127.0.0.1") || rpc.url.includes("localhost")) {
    envChecks.push(pass("TREASURY_WALLET_RPC_URL is local", rpc.url));
  } else {
    envChecks.push(
      fail("TREASURY_WALLET_RPC_URL should be localhost", `Got ${rpc.url} — Sage RPC must not be remote`),
    );
  }

  if (rpc.sageFingerprint) {
    envChecks.push(pass("TREASURY_SAGE_FINGERPRINT set", String(rpc.sageFingerprint)));
  } else {
    envChecks.push(fail("TREASURY_SAGE_FINGERPRINT missing", "Copy from Sage Settings or sage rpc get_keys"));
  }

  envChecks.push(
    pass("Treasury service bind", `${config.host}:${config.port}`),
  );

  const envOk = printResults("Environment", envChecks);

  const certChecks: CheckResult[] = [];
  const defaults = defaultSageCertPaths();
  const certPath = rpc.certPath ?? defaults.certPath;
  const keyPath = rpc.keyPath ?? defaults.keyPath;

  if (certPath && existsSync(certPath)) {
    certChecks.push(pass("Sage wallet.crt found", certPath));
  } else {
    certChecks.push(
      fail(
        "Sage wallet.crt not found",
        "Enable RPC in Sage (Settings → Advanced) or set TREASURY_WALLET_CERT_PATH",
      ),
    );
  }

  if (keyPath && existsSync(keyPath)) {
    certChecks.push(pass("Sage wallet.key found", keyPath));
  } else {
    certChecks.push(
      fail(
        "Sage wallet.key not found",
        "Enable RPC in Sage (Settings → Advanced) or set TREASURY_WALLET_KEY_PATH",
      ),
    );
  }

  const certsOk = printResults("Sage SSL certificates", certChecks);

  const sageChecks: CheckResult[] = [];
  if (certPath && keyPath && existsSync(certPath) && existsSync(keyPath)) {
    const reachable = await pingTreasuryWalletRpc({ ...rpc, certPath, keyPath });
    if (reachable) {
      sageChecks.push(pass("Sage RPC reachable", rpc.url));
    } else {
      sageChecks.push(
        fail("Sage RPC not reachable", "Open Sage, enable RPC on port 9257, keep wallet running"),
      );
    }

    if (reachable && rpc.sageFingerprint) {
      try {
        await treasuryWalletRpcRequest({ ...rpc, certPath, keyPath }, "login", {
          fingerprint: rpc.sageFingerprint,
        });
        sageChecks.push(pass("Sage login with treasury fingerprint"));
      } catch (e) {
        sageChecks.push(fail("Sage login failed", (e as Error).message));
      }
    }

    if (reachable && !rpc.sageFingerprint) {
      try {
        const keys = await treasuryWalletRpcRequest<{ keys?: Array<{ fingerprint: number; name?: string }> }>(
          { ...rpc, certPath, keyPath },
          "get_keys",
          {},
        );
        const fingerprints = keys.keys?.map((k) => `${k.fingerprint}${k.name ? ` (${k.name})` : ""}`) ?? [];
        if (fingerprints.length > 0) {
          sageChecks.push(
            fail("Pick a treasury fingerprint and set TREASURY_SAGE_FINGERPRINT", fingerprints.join(", ")),
          );
        } else {
          sageChecks.push(fail("No Sage keys returned from get_keys"));
        }
      } catch (e) {
        sageChecks.push(fail("Could not list Sage keys", (e as Error).message));
      }
    }
  } else {
    sageChecks.push(fail("Skipped Sage RPC checks", "Fix certificate paths first"));
  }

  const sageOk = printResults("Sage wallet RPC", sageChecks);

  const allOk = envOk && certsOk && sageOk;

  console.log("\nNext steps");
  if (allOk) {
    console.log("  1. Start treasury service:  pnpm dev:treasury");
    console.log("  2. Verify health:           curl -s http://localhost:4200/health | jq");
    console.log("  3. Firewall port 4200 so ONLY your game API host can reach /payout");
    console.log("  4. On game host set:        DAT_TREASURY_PAYOUT_URL=http://<TREASURY_IP>:4200/payout");
  } else {
    console.log("  Fix the failed checks above, then re-run:  pnpm treasury:check");
    console.log("  Full guide: docs/TREASURY.md");
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
