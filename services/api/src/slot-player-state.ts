import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HouseEdgeState } from "@dat-poker/slot-engine";
import { defaultHouseEdgeState } from "@dat-poker/slot-engine";

const __dirname = dirname(fileURLToPath(import.meta.url));

type PokerHoldPending = {
  grid: string[][];
  betMojos: string;
  expiresAt: number;
};

type PlayerSlotState = {
  houseEdge: HouseEdgeState;
  pokerHold?: PokerHoldPending;
};

const byPlayer = new Map<string, PlayerSlotState>();
let loaded = false;

function statePath(): string | null {
  const raw = process.env.DAT_SLOT_PLAYER_STATE_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return resolve(__dirname, "../../../data/slot-player-state.json");
}

function persist(): void {
  const path = statePath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const obj: Record<string, PlayerSlotState> = {};
  for (const [k, v] of byPlayer) obj[k] = v;
  writeFileSync(path, JSON.stringify(obj, null, 2), { encoding: "utf8", mode: 0o600 });
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const path = statePath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, PlayerSlotState>;
    for (const [k, v] of Object.entries(parsed)) {
      byPlayer.set(k, {
        houseEdge: v.houseEdge ?? defaultHouseEdgeState(),
        pokerHold: v.pokerHold,
      });
    }
  } catch {
    /* empty */
  }
}

function get(playerId: string): PlayerSlotState {
  load();
  let s = byPlayer.get(playerId);
  if (!s) {
    s = { houseEdge: defaultHouseEdgeState() };
    byPlayer.set(playerId, s);
  }
  return s;
}

export function getHouseEdgeState(playerId: string): HouseEdgeState {
  return { ...get(playerId).houseEdge };
}

export function setHouseEdgeState(playerId: string, state: HouseEdgeState): void {
  const s = get(playerId);
  s.houseEdge = state;
  persist();
}

export function setPokerHoldPending(
  playerId: string,
  grid: string[][],
  betMojos: string,
): void {
  const s = get(playerId);
  s.pokerHold = {
    grid,
    betMojos,
    expiresAt: Date.now() + 5 * 60_000,
  };
  persist();
}

export function takePokerHoldPending(playerId: string): PokerHoldPending | null {
  const s = get(playerId);
  const pending = s.pokerHold;
  if (!pending) return null;
  if (pending.expiresAt < Date.now()) {
    delete s.pokerHold;
    persist();
    return null;
  }
  delete s.pokerHold;
  persist();
  return pending;
}

export function clearPokerHoldPending(playerId: string): void {
  const s = get(playerId);
  if (s.pokerHold) {
    delete s.pokerHold;
    persist();
  }
}

export function resetSlotPlayerStateForTests(): void {
  loaded = false;
  byPlayer.clear();
}
