import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  auditHistoryStacks,
  type HandResult,
  type NlheTableEngine,
} from "@dat-poker/game-engine";

export interface HandHistoryEntry {
  handId: string;
  completedAtMs: number;
  winnerId: string;
  potMojos: string;
  totalPotMojos: string;
  isChop: boolean;
  reason: "fold" | "showdown";
  board: HandResult["board"];
  shown: HandResult["shown"];
  participants: {
    playerId: string;
    totalBetHandMojos: string;
    stackBeforePayoutMojos: string;
    stackAfterMojos: string;
    awardedMojos: string;
  }[];
  /** Present when settlement invariants failed (should be empty in healthy play). */
  auditIssues?: string[];
}

const MAX_HANDS_PER_TABLE = 40;
const historyByTable = new Map<string, HandHistoryEntry[]>();
const recordedKeys = new Set<string>();

function recordKey(tableId: string, handId: string): string {
  return `${tableId}:${handId}`;
}

function handHistoryLogPath(): string | null {
  const raw = process.env.DAT_HAND_HISTORY_PATH?.trim();
  if (!raw || raw === "off" || raw === "memory") return null;
  return resolve(raw);
}

async function appendHandHistoryLog(
  tableId: string,
  entry: HandHistoryEntry,
): Promise<void> {
  const path = handHistoryLogPath();
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify({ tableId, ...entry })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (err) {
    console.error("[hand-history] failed to append log", err);
  }
}

export function maybeRecordCompletedHand(tableId: string, table: NlheTableEngine): void {
  if (table.isHandInProgress()) return;
  void recordHandHistoryIfNew(tableId, table);
}

export function recordHandHistoryIfNew(tableId: string, table: NlheTableEngine): void {
  const result = table.getLastHandResult();
  if (!result) return;
  const key = recordKey(tableId, result.handId);
  if (recordedKeys.has(key)) return;
  recordedKeys.add(key);

  const stacksAfter = new Map(
    table.getSeatedPlayers().map((s) => [s.playerId, s.stackMojos] as const),
  );

  const participants = result.participants.map((p) => {
    const stackAfter = stacksAfter.get(p.playerId) ?? p.stackBeforePayoutMojos;
    return {
      playerId: p.playerId,
      totalBetHandMojos: p.totalBetHandMojos.toString(),
      stackBeforePayoutMojos: p.stackBeforePayoutMojos.toString(),
      stackAfterMojos: stackAfter.toString(),
      awardedMojos: p.awardedMojos.toString(),
    };
  });

  const auditIssues = auditHistoryStacks({
    totalPotMojos: result.totalPotMojos,
    potMojos: result.potMojos,
    winnerId: result.winnerId,
    isChop: result.isChop,
    participants: participants.map((p) => ({
      playerId: p.playerId,
      stackBeforePayoutMojos: BigInt(p.stackBeforePayoutMojos),
      stackAfterMojos: BigInt(p.stackAfterMojos),
    })),
  }).map((issue) => `${issue.code}: ${issue.message}`);

  if (auditIssues.length > 0) {
    console.error(
      `[hand-history] settlement audit failed table=${tableId} hand=${result.handId}`,
      auditIssues,
    );
  }

  const entry: HandHistoryEntry = {
    handId: result.handId,
    completedAtMs: Date.now(),
    winnerId: result.winnerId,
    potMojos: result.potMojos.toString(),
    totalPotMojos: result.totalPotMojos.toString(),
    isChop: result.isChop,
    reason: result.reason,
    board: result.board,
    shown: result.shown,
    participants,
    ...(auditIssues.length > 0 ? { auditIssues } : {}),
  };

  const list = historyByTable.get(tableId) ?? [];
  list.unshift(entry);
  if (list.length > MAX_HANDS_PER_TABLE) {
    list.length = MAX_HANDS_PER_TABLE;
  }
  historyByTable.set(tableId, list);
  void appendHandHistoryLog(tableId, entry);
}

export function getHandHistory(tableId: string, limit = 20): HandHistoryEntry[] {
  const list = historyByTable.get(tableId) ?? [];
  return list.slice(0, Math.min(limit, list.length));
}

/** All in-memory histories across tables (newest first per table). For host audits. */
export function getAllHandHistory(limitPerTable = 40): { tableId: string; hands: HandHistoryEntry[] }[] {
  const out: { tableId: string; hands: HandHistoryEntry[] }[] = [];
  for (const [tableId, list] of historyByTable) {
    out.push({ tableId, hands: list.slice(0, Math.min(limitPerTable, list.length)) });
  }
  return out;
}

export function resetHandHistoryForTests(): void {
  historyByTable.clear();
  recordedKeys.clear();
}
