import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DAT_PLAY_DEFAULTS, SLOT_GAME_IDS, type SlotGameId } from "@dat-poker/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

const jackpots = new Map<SlotGameId, bigint>();
let loaded = false;

function seedForGame(_gameId: SlotGameId): bigint {
  return DAT_PLAY_DEFAULTS.jackpotSeedMojos;
}

function defaultJackpotPath(): string {
  return resolve(__dirname, "../../../data/slots-jackpot.json");
}

function jackpotPath(): string | null {
  const raw = process.env.DAT_SLOTS_JACKPOT_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return defaultJackpotPath();
}

function ensureGameLoaded(gameId: SlotGameId): void {
  if (!jackpots.has(gameId)) {
    jackpots.set(gameId, seedForGame(gameId));
  }
}

function persistJackpot(): void {
  const path = jackpotPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const body: Record<string, string> = { updatedAt: new Date().toISOString() };
  for (const id of SLOT_GAME_IDS) {
    ensureGameLoaded(id);
    body[id] = jackpots.get(id)!.toString();
  }
  writeFileSync(path, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600 });
}

function loadJackpot(): void {
  if (loaded) return;
  loaded = true;
  for (const id of SLOT_GAME_IDS) {
    jackpots.set(id, seedForGame(id));
  }
  const path = jackpotPath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, string> & {
      progressiveJackpotMojos?: string;
    };
    if (parsed.progressiveJackpotMojos && !parsed.spirit) {
      jackpots.set("spirit", BigInt(parsed.progressiveJackpotMojos));
    }
    for (const id of SLOT_GAME_IDS) {
      const raw = parsed[id];
      if (raw) jackpots.set(id, BigInt(raw));
    }
  } catch {
    /* first boot */
  }
}

export function readProgressiveJackpotMojos(gameId: SlotGameId = "spirit"): bigint {
  loadJackpot();
  ensureGameLoaded(gameId);
  return jackpots.get(gameId)!;
}

export function readAllProgressiveJackpots(): Record<SlotGameId, string> {
  loadJackpot();
  const out = {} as Record<SlotGameId, string>;
  for (const id of SLOT_GAME_IDS) {
    ensureGameLoaded(id);
    out[id] = jackpots.get(id)!.toString();
  }
  return out;
}

export function contributeToJackpot(
  gameId: SlotGameId,
  spinCostMojos: bigint,
  contributionBps: number,
): void {
  loadJackpot();
  ensureGameLoaded(gameId);
  const next = jackpots.get(gameId)! + (spinCostMojos * BigInt(contributionBps)) / 10_000n;
  jackpots.set(gameId, next);
  persistJackpot();
}

export function payoutProgressiveJackpot(gameId: SlotGameId): bigint {
  loadJackpot();
  ensureGameLoaded(gameId);
  const amount = jackpots.get(gameId)!;
  jackpots.set(gameId, seedForGame(gameId));
  persistJackpot();
  return amount;
}

export function resetJackpotForTests(seed = DAT_PLAY_DEFAULTS.jackpotSeedMojos): void {
  loaded = false;
  jackpots.clear();
  for (const id of SLOT_GAME_IDS) {
    jackpots.set(id, seed);
  }
}

export function reloadJackpotFromDiskForTests(): void {
  loaded = false;
  jackpots.clear();
  loadJackpot();
}
