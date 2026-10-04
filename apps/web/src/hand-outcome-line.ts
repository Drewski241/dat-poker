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

/**
 * Human-readable hand outcome. Chops used to look like a half-paid pot because
 * `potMojos` is the primary winner's share, not the full pot.
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

  // Side pots can pay multiple players without tying — only trust engine `isChop`.
  const chopped = hand.isChop === true;

  if (chopped) {
    const total =
      hand.totalPotMojos != null
        ? BigInt(hand.totalPotMojos)
        : withAfter.length > 0
          ? totalPotFromParticipants(withAfter)
          : BigInt(hand.potMojos);
    const you = withAfter.find((p) => p.playerId === playerId);
    const yourShare =
      you != null
        ? participantAwardMojos(you)
        : hand.winnerId === playerId
          ? BigInt(hand.potMojos)
          : null;
    const shareBit =
      yourShare != null && yourShare > 0n
        ? ` · you got ${formatDatMojos(yourShare.toString(), ticker)}`
        : yourShare === 0n
          ? " · you got 0"
          : "";
    return `Chop · pot ${formatDatMojos(total.toString(), ticker)}${shareBit} · ${reason}`;
  }

  return `${winnerLabel} won ${formatDatMojos(hand.potMojos, ticker)} · ${reason}`;
}
