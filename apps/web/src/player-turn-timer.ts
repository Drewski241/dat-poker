/** How long the player has to act on their turn. */
export const PLAYER_ACTION_LIMIT_MS = 30_000;

/** Sloth reminder appears after this delay (still within the action limit). */
export const SLOTH_APPEAR_DELAY_MS = 15_000;

export function actionSecondsRemaining(elapsedMs: number): number {
  return Math.max(0, Math.ceil((PLAYER_ACTION_LIMIT_MS - elapsedMs) / 1000));
}

export function shouldShowSloth(elapsedMs: number, isMyTurn: boolean): boolean {
  return isMyTurn && elapsedMs >= SLOTH_APPEAR_DELAY_MS;
}

export function actionTimedOut(elapsedMs: number): boolean {
  return elapsedMs >= PLAYER_ACTION_LIMIT_MS;
}

export function turnTimerKey(hand: {
  handId: string;
  actionSeat: number | null;
  street: string;
  currentBetMojos: string;
}): string {
  return `${hand.handId}:${hand.actionSeat}:${hand.street}:${hand.currentBetMojos}`;
}
