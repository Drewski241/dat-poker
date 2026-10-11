import type { HandResult, HandResultParticipant } from "./nlhe-table.js";

export interface PotAuditIssue {
  code:
    | "award_sum_mismatch"
    | "total_pot_mismatch"
    | "stack_delta_mismatch"
    | "negative_award"
    | "chop_flag_inconsistent"
    | "primary_share_mismatch";
  message: string;
}

/**
 * Re-check a finished hand's settlement invariants from `HandResult` alone.
 * Useful for reviewing live hand-history dumps without replaying actions.
 */
export function auditHandResult(result: HandResult): PotAuditIssue[] {
  const issues: PotAuditIssue[] = [];
  const awardSum = result.participants.reduce((sum, p) => sum + p.awardedMojos, 0n);
  if (awardSum !== result.totalPotMojos) {
    issues.push({
      code: "award_sum_mismatch",
      message: `participant awards sum to ${awardSum}, totalPotMojos is ${result.totalPotMojos}`,
    });
  }

  const positiveAwards = result.participants.filter((p) => p.awardedMojos > 0n);
  if (result.isChop && positiveAwards.length < 2) {
    issues.push({
      code: "chop_flag_inconsistent",
      message: "isChop is true but fewer than two players received chips",
    });
  }

  const primary = result.participants.find((p) => p.playerId === result.winnerId);
  if (primary && primary.awardedMojos !== result.potMojos) {
    issues.push({
      code: "primary_share_mismatch",
      message: `winnerId share ${primary.awardedMojos} != potMojos ${result.potMojos}`,
    });
  }

  for (const p of result.participants) {
    if (p.awardedMojos < 0n) {
      issues.push({
        code: "negative_award",
        message: `${p.playerId} has negative award ${p.awardedMojos}`,
      });
    }
  }

  return issues;
}

/** Audit a hand-history row that only has stack before/after (no awardedMojos). */
export function auditHistoryStacks(params: {
  totalPotMojos: bigint;
  potMojos: bigint;
  winnerId: string;
  isChop: boolean;
  participants: Array<{
    playerId: string;
    stackBeforePayoutMojos: bigint;
    stackAfterMojos: bigint;
  }>;
}): PotAuditIssue[] {
  const asResult: HandResult = {
    handId: "audit",
    winnerId: params.winnerId,
    potMojos: params.potMojos,
    totalPotMojos: params.totalPotMojos,
    isChop: params.isChop,
    reason: "showdown",
    board: [],
    shown: [],
    allInPlayerIds: [],
    runoutFromBoardLen: null,
    participants: params.participants.map(
      (p): HandResultParticipant => ({
        playerId: p.playerId,
        totalBetHandMojos: 0n,
        stackBeforePayoutMojos: p.stackBeforePayoutMojos,
        awardedMojos: p.stackAfterMojos - p.stackBeforePayoutMojos,
      }),
    ),
  };
  const issues = auditHandResult(asResult);
  for (const p of params.participants) {
    if (p.stackAfterMojos < p.stackBeforePayoutMojos) {
      issues.push({
        code: "stack_delta_mismatch",
        message: `${p.playerId} stack fell at payout (${p.stackBeforePayoutMojos} → ${p.stackAfterMojos})`,
      });
    }
  }
  return issues;
}
