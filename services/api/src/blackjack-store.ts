import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BlackjackTable, type BlackjackSnapshot } from "@dat-poker/game-engine";

const BIGINT_KEYS = new Set([
  "stackMojos",
  "minBetMojos",
  "maxBetMojos",
  "betMojos",
  "profitMojos",
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

export function saveBlackjackTables(file: string, tables: BlackjackTable[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const json = JSON.stringify(
    { version: 1, tables: tables.map((table) => table.toSnapshot()) },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, json);
  renameSync(tmp, file);
}

export function loadBlackjackTables(file: string): BlackjackTable[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as { tables?: unknown };
  const revived = revive(parsed.tables ?? []) as BlackjackSnapshot[];
  return revived.map((snapshot) => BlackjackTable.fromSnapshot(snapshot));
}
