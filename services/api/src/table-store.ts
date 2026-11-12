import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EngineSnapshot } from "@dat-poker/game-engine";
import type { SitAndGoState } from "./sit-and-go.js";
import type { BuyInRecord } from "./buy-in-store.js";
import type { WithdrawalRecord } from "./withdraw-store.js";

export interface StoredTable {
  id: string;
  names: [string, string][];
  sng: SitAndGoState | null;
  engine: EngineSnapshot;
}

export interface StoredRoom {
  tables: StoredTable[];
  buyIns: { tableId: string; playerId: string; record: BuyInRecord }[];
  withdrawals: WithdrawalRecord[];
}

const BIGINT_KEYS = new Set([
  "smallBlindMojos",
  "bigBlindMojos",
  "minBuyInMojos",
  "maxBuyInMojos",
  "stackMojos",
  "potMojos",
  "currentBetMojos",
  "betThisStreetMojos",
  "totalBetHandMojos",
  "amountMojos",
  "entryMojos",
  "startingStackMojos",
  "prizeMojos",
]);

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (BIGINT_KEYS.has(key) && (typeof inner === "string" || typeof inner === "bigint")) {
      out[key] = BigInt(inner);
    } else {
      out[key] = revive(inner);
    }
  }
  return out;
}

export function saveRoom(file: string, room: StoredRoom): void {
  mkdirSync(dirname(file), { recursive: true });
  const json = JSON.stringify({ version: 1, ...room }, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, json);
  renameSync(tmp, file);
}

export function loadRoom(file: string): StoredRoom {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { tables: [], buyIns: [], withdrawals: [] };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as { tables?: unknown; buyIns?: unknown; withdrawals?: unknown };
  const revived = revive({
    tables: parsed.tables ?? [],
    buyIns: parsed.buyIns ?? [],
    withdrawals: parsed.withdrawals ?? [],
  }) as StoredRoom;
  return revived;
}
