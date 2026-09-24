export type RunoutStreet = "allin" | "flop" | "turn" | "river" | "hands";

export type RunoutLive = {
  boardLen: number;
  allIn: boolean;
  allInPlayerIds?: string[];
  viewerId?: string | null;
  viewerFolded?: boolean;
};

export type RunoutResult = {
  reason: string;
  board?: unknown[];
  winnerId?: string;
  allInPlayerIds?: string[];
  shown?: { playerId: string; allIn?: boolean }[];
};

export function formatHandCategory(category: string | undefined): string {
  if (!category) return "";
  return category.replace(/_/g, " ");
}

export function runoutAllInPlayerIds(live: RunoutLive, result: RunoutResult | null): string[] {
  const ids = new Set<string>();
  for (const id of live.allInPlayerIds ?? []) {
    if (id) ids.add(id);
  }
  for (const id of result?.allInPlayerIds ?? []) {
    if (id) ids.add(id);
  }
  for (const shown of result?.shown ?? []) {
    if (shown.allIn && shown.playerId) ids.add(shown.playerId);
  }
  if (live.allIn && live.viewerId && !live.viewerFolded) {
    ids.add(live.viewerId);
  }
  return [...ids];
}

export function shouldPlayAllInRunout(live: RunoutLive, result: RunoutResult | null): boolean {
  if (!result || result.reason !== "showdown") return false;
  const finalLen = result.board?.length ?? 0;
  if (finalLen < 5) return false;
  return runoutAllInPlayerIds(live, result).length > 0;
}

export function runoutStreets(fromBoardLen: number): RunoutStreet[] {
  const streets: RunoutStreet[] = ["allin"];
  if (fromBoardLen < 3) streets.push("flop");
  if (fromBoardLen < 4) streets.push("turn");
  if (fromBoardLen < 5) streets.push("river");
  streets.push("hands");
  return streets;
}

export function runoutVisibleCount(street: RunoutStreet, fromBoardLen = 0): number {
  if (street === "allin") return Math.max(0, Math.min(fromBoardLen, 5));
  if (street === "flop") return 3;
  if (street === "turn") return 4;
  return 5;
}

export function runoutShowHoleCards(_street: RunoutStreet): boolean {
  return true;
}

export function runoutShowOutcome(street: RunoutStreet): boolean {
  return street === "hands";
}

export function runoutHandsToShow<T extends { playerId: string }>(
  shown: T[] | undefined,
  allInPlayerIds: string[],
): T[] {
  const rows = shown ?? [];
  if (rows.length === 0) return [];
  if (allInPlayerIds.length === 0) return rows;
  const matched = rows.filter((row) => allInPlayerIds.includes(row.playerId));
  return matched.length > 0 ? matched : rows;
}

export function runoutHoldMs(street: RunoutStreet, lost = false): number {
  if (street === "allin") return 1800;
  if (street === "flop") return 2400;
  if (street === "turn") return 2200;
  if (street === "river") return 2400;
  return lost ? 5200 : 3400;
}
