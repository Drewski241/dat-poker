import type { HandResult, NlheTableEngine } from "@dat-poker/game-engine";

export interface HandHistoryEntry {
  handId: string;
  completedAtMs: number;
  winnerId: string;
  potMojos: string;
  reason: "fold" | "showdown";
  board: HandResult["board"];
  shown: HandResult["shown"];
  participants: {
    playerId: string;
    totalBetHandMojos: string;
    stackBeforePayoutMojos: string;
    stackAfterMojos: string;
  }[];
}

const MAX_HANDS_PER_TABLE = 40;
const historyByTable = new Map<string, HandHistoryEntry[]>();
const recordedKeys = new Set<string>();

function recordKey(tableId: string, handId: string): string {
  return `${tableId}:${handId}`;
}

export function maybeRecordCompletedHand(tableId: string, table: NlheTableEngine): void {
  if (table.isHandInProgress()) return;
  recordHandHistoryIfNew(tableId, table);
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

  const entry: HandHistoryEntry = {
    handId: result.handId,
    completedAtMs: Date.now(),
    winnerId: result.winnerId,
    potMojos: result.potMojos.toString(),
    reason: result.reason,
    board: result.board,
    shown: result.shown,
    participants: result.participants.map((p) => ({
      playerId: p.playerId,
      totalBetHandMojos: p.totalBetHandMojos.toString(),
      stackBeforePayoutMojos: p.stackBeforePayoutMojos.toString(),
      stackAfterMojos: (stacksAfter.get(p.playerId) ?? p.stackBeforePayoutMojos).toString(),
    })),
  };

  const list = historyByTable.get(tableId) ?? [];
  list.unshift(entry);
  if (list.length > MAX_HANDS_PER_TABLE) {
    list.length = MAX_HANDS_PER_TABLE;
  }
  historyByTable.set(tableId, list);
}

export function getHandHistory(tableId: string, limit = 20): HandHistoryEntry[] {
  const list = historyByTable.get(tableId) ?? [];
  return list.slice(0, Math.min(limit, list.length));
}

export function resetHandHistoryForTests(): void {
  historyByTable.clear();
  recordedKeys.clear();
}
