export type RunoutStreet = "allin" | "flop" | "turn" | "river" | "hands";

export function formatHandCategory(category: string | undefined): string {
  if (!category) return "";
  return category.replace(/_/g, " ");
}

export function shouldPlayAllInRunout(
  live: {
    boardLen: number;
    allIn: boolean;
  },
  result: { reason: string; board?: unknown[]; winnerId?: string } | null,
): boolean {
  if (!result || result.reason !== "showdown") return false;
  const finalLen = result.board?.length ?? 0;
  if (finalLen < 5) return false;
  // Win or lose: an all-in showdown always gets the cinema so the player can
  // watch the cards and study the hands.
  if (live.allIn) return true;
  const skipped = finalLen - Math.max(0, live.boardLen);
  return skipped >= 2;
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

export function runoutHoldMs(street: RunoutStreet, lost = false): number {
  if (street === "allin") return 1800;
  if (street === "flop") return 2400;
  if (street === "turn") return 2200;
  if (street === "river") return 2400;
  return lost ? 5200 : 3400;
}
