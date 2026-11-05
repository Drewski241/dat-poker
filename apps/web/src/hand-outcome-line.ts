import { formatDatMojos } from "@dat-poker/shared";
import { participantAwardMojos, totalPotFromParticipants } from "./hand-result-copy.js";

type OutcomeParticipant = {
  playerId: string;
  stackBeforePayoutMojos: string;
  stackAfterMojos?: string;
};

type OutcomeHand = {
  winnerId: string;
  potMojos: string;
  totalPotMojos?: string;
  isChop?: boolean;
  reason: "fold" | "showdown";
  participants?: OutcomeParticipant[];
};

function totalPotOf(hand: OutcomeHand, withAfter: Array<OutcomeParticipant & { stackAfterMojos: string }>): bigint {
  if (hand.totalPotMojos != null) return BigInt(hand.totalPotMojos);
  if (withAfter.length > 0) return totalPotFromParticipants(withAfter);
  return BigInt(hand.potMojos);
}

function yourShareBit(
  hand: OutcomeHand,
  playerId: string,
  withAfter: Array<OutcomeParticipant & { stackAfterMojos: string }>,
  ticker?: string,
): string {
  const you = withAfter.find((p) => p.playerId === playerId);
  const yourShare =
    you != null
      ? participantAwardMojos(you)
      : hand.winnerId === playerId
        ? BigInt(hand.potMojos)
        : null;
  if (yourShare != null && yourShare > 0n) {
    return ` · you got ${formatDatMojos(yourShare.toString(), ticker)}`;
  }
  if (yourShare === 0n) return " · you got 0";
  return "";
}

/**
 * Human-readable hand outcome.
 * - Chop = tied hands splitting a pot layer (equal strength).
 * - Side pots = different winners on main vs side (not a chop).
 * - Sole win = one player took the contested pot.
 */
export function formatHandOutcomeLine(params: {
  hand: OutcomeHand;
  playerId: string;
  winnerLabel: string;
  ticker?: string;
}): string {
  const { hand, playerId, winnerLabel, ticker } = params;
  const reason = hand.reason === "showdown" ? "showdown" : "fold";

  const withAfter = (hand.participants ?? []).filter(
    (p): p is OutcomeParticipant & { stackAfterMojos: string } => p.stackAfterMojos != null,
  );

  const paidWinners = withAfter.filter((p) => participantAwardMojos(p) > 0n).length;
  const total = totalPotOf(hand, withAfter);
  const shareBit = yourShareBit(hand, playerId, withAfter, ticker);

  // Only trust engine `isChop` — never infer from multi-winner side pots.
  if (hand.isChop === true) {
    return `Chop · pot ${formatDatMojos(total.toString(), ticker)}${shareBit} · ${reason}`;
  }

  // Main + side: short all-in wins one layer, another player wins the rest.
  if (paidWinners > 1) {
    return `Side pots · pot ${formatDatMojos(total.toString(), ticker)}${shareBit} · ${reason}`;
  }

  return `${winnerLabel} won ${formatDatMojos(hand.potMojos, ticker)} · ${reason}`;
}
