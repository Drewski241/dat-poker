export type RunoutStreet = "allin" | "flop" | "turn" | "river" | "hands";

export type RunoutLive = {
  boardLen: number;
  allIn: boolean;
  allInPlayerIds?: string[];
  viewerId?: string | null;
  viewerFolded?: boolean;
  bettingClosed?: boolean;
};

export type RunoutResult = {
  reason: string;
  board?: unknown[];
  winnerId?: string;
  allInPlayerIds?: string[];
  runoutFromBoardLen?: number | null;
  shown?: { playerId: string; allIn?: boolean }[];
};

export function allInBettingClosed(
  players: Array<{ folded?: boolean; allIn?: boolean; stackMojos?: string }>,
): boolean {
  const live = players.filter((p) => !p.folded);
  if (live.length < 2) return false;
  if (!live.some((p) => p.allIn)) return false;
  const canBet = live.filter((p) => {
    if (p.allIn) return false;
    try {
      return BigInt(p.stackMojos ?? "0") > 0n;
    } catch {
      return false;
    }
  });
  return canBet.length <= 1;
}

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
  if (result.runoutFromBoardLen === null) return false;
  if (live.bettingClosed === false && result.runoutFromBoardLen == null) return false;
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

export function runoutShowHoleCards(_street: RunoutStreet, bettingClosed = true): boolean {
  return bettingClosed;
}

export function runoutShowOutcome(street: RunoutStreet): boolean {
  return street === "hands";
}

export function runoutHandsToShow<T extends { playerId: string }>(
  shown: T[] | undefined,
  _allInPlayerIds: string[] = [],
): T[] {
  return shown ?? [];
}

export function runoutMatchupLine(
  allInPlayerIds: string[],
  shownPlayerIds: string[],
  label: (id: string) => string,
): string {
  const allIn = allInPlayerIds.filter(Boolean);
  const others = shownPlayerIds.filter((id) => id && !allIn.includes(id));
  const allInNames = allIn.map(label).filter(Boolean);
  const otherNames = others.map(label).filter(Boolean);
  if (allInNames.length > 0 && otherNames.length > 0) {
    return `${allInNames.join(" · ")} vs ${otherNames.join(" · ")}`;
  }
  if (allInNames.length > 1) return allInNames.join(" vs ");
  return [...allInNames, ...otherNames].join(" · ");
}

export function runoutHoldMs(street: RunoutStreet, lost = false): number {
  if (street === "allin") return 1800;
  if (street === "flop") return 2400;
  if (street === "turn") return 2200;
  if (street === "river") return 2400;
  return lost ? 5200 : 3400;
}
