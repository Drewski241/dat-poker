export type RunoutStreet = "flop" | "turn" | "river" | "hands";

export function formatHandCategory(category: string | undefined): string {
  if (!category) return "";
  return category.replace(/_/g, " ");
}

export function shouldPlayAllInRunout(live: {
  boardLen: number;
  allIn: boolean;
}, result: { reason: string; board?: unknown[] } | null): boolean {
  if (!result || result.reason !== "showdown") return false;
  const finalLen = result.board?.length ?? 0;
  if (finalLen < 5) return false;
  const skipped = finalLen - live.boardLen;
  if (skipped <= 0) return false;
  if (skipped >= 2) return true;
  return live.allIn;
}

export function runoutStreets(fromBoardLen: number): RunoutStreet[] {
  const streets: RunoutStreet[] = [];
  if (fromBoardLen < 3) streets.push("flop");
  if (fromBoardLen < 4) streets.push("turn");
  if (fromBoardLen < 5) streets.push("river");
  streets.push("hands");
  return streets;
}

export function runoutVisibleCount(street: RunoutStreet): number {
  if (street === "flop") return 3;
  if (street === "turn") return 4;
  return 5;
}

export function runoutHoldMs(street: RunoutStreet): number {
  if (street === "flop") return 1800;
  if (street === "turn") return 1600;
  if (street === "river") return 1800;
  return 2200;
}
