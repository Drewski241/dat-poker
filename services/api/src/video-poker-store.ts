import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { VideoPokerTable, type VideoPokerSnapshot } from "@dat-poker/game-engine";

const BIGINT_KEYS = new Set(["stackMojos", "coinMojos", "betMojos", "payoutMojos", "profitMojos"]);

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (BIGINT_KEYS.has(key) && (typeof inner === "string" || typeof inner === "bigint")) {
      out[key] = BigInt(inner);
    } else if (BIGINT_KEYS.has(key) && inner === null) {
      out[key] = null;
    } else {
      out[key] = revive(inner);
    }
  }
  return out;
}

export function saveVideoPokerTables(file: string, tables: VideoPokerTable[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const json = JSON.stringify(
    { version: 1, tables: tables.map((table) => table.toSnapshot()) },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, json);
  renameSync(tmp, file);
}

export function loadVideoPokerTables(file: string): VideoPokerTable[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as { tables?: unknown };
  const revived = revive(parsed.tables ?? []) as VideoPokerSnapshot[];
  return revived.map((snapshot) => VideoPokerTable.fromSnapshot(snapshot));
}
