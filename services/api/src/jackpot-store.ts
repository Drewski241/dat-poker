import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DAT_PLAY_DEFAULTS } from "@dat-poker/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

let progressiveJackpotMojos: bigint = DAT_PLAY_DEFAULTS.jackpotSeedMojos;
let loaded = false;

function defaultJackpotPath(): string {
  return resolve(__dirname, "../../../data/slots-jackpot.json");
}

function jackpotPath(): string | null {
  const raw = process.env.DAT_SLOTS_JACKPOT_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return defaultJackpotPath();
}

function persistJackpot(): void {
  const path = jackpotPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(
    {
      progressiveJackpotMojos: progressiveJackpotMojos.toString(),
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
}

function loadJackpot(): void {
  if (loaded) return;
  loaded = true;
  const path = jackpotPath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      progressiveJackpotMojos?: string;
    };
    if (parsed.progressiveJackpotMojos) {
      progressiveJackpotMojos = BigInt(parsed.progressiveJackpotMojos);
    }
  } catch {
    /* first boot — keep seed; next persist writes the file */
  }
}

export function readProgressiveJackpotMojos(): bigint {
  loadJackpot();
  return progressiveJackpotMojos;
}

export function contributeToJackpot(spinCostMojos: bigint, contributionBps: number): void {
  loadJackpot();
  progressiveJackpotMojos += (spinCostMojos * BigInt(contributionBps)) / 10_000n;
  persistJackpot();
}

export function payoutProgressiveJackpot(): bigint {
  loadJackpot();
  const amount = progressiveJackpotMojos;
  progressiveJackpotMojos = DAT_PLAY_DEFAULTS.jackpotSeedMojos;
  persistJackpot();
  return amount;
}

export function resetJackpotForTests(seed = DAT_PLAY_DEFAULTS.jackpotSeedMojos): void {
  loaded = false;
  progressiveJackpotMojos = seed;
}

/** Clears the in-memory cache so the next read loads from disk (tests / hot reload). */
export function reloadJackpotFromDiskForTests(): void {
  loaded = false;
  progressiveJackpotMojos = DAT_PLAY_DEFAULTS.jackpotSeedMojos;
}
