/**
 * Crack the Vault — a press-your-luck bonus shared by every slot machine.
 * A paid spin unlocks it about once per {@link VAULT_BONUS_EVERY_N} spins.
 * The board is four prize chips and one rake. Flipping the rake ends the
 * round and keeps the prizes already flipped.
 */

export const VAULT_BONUS_EVERY_N = 64;

/** Multipliers of the spin bet that unlocked the bonus. */
export const VAULT_PRIZE_MULTIPLIERS = [1, 1, 2, 3] as const;

export type VaultCard = { kind: "prize"; multiplier: number } | { kind: "rake" };

export function buildVaultCards(randomInt: (max: number) => number): VaultCard[] {
  const cards: VaultCard[] = [
    ...VAULT_PRIZE_MULTIPLIERS.map((multiplier) => ({ kind: "prize" as const, multiplier })),
    { kind: "rake" },
  ];
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const swap = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = swap;
  }
  return cards;
}

export function vaultCollectedMultiplier(cards: VaultCard[], revealed: readonly number[]): number {
  let total = 0;
  for (const index of revealed) {
    const card = cards[index];
    if (card?.kind === "prize") total += card.multiplier;
  }
  return total;
}

export function vaultIsFinished(cards: VaultCard[], revealed: readonly number[]): boolean {
  if (revealed.some((index) => cards[index]?.kind === "rake")) return true;
  return cards.every((card, index) => card.kind !== "prize" || revealed.includes(index));
}

export function flipVaultCard(
  cards: VaultCard[],
  revealed: readonly number[],
  index: number,
): { revealed: number[]; card: VaultCard; collectedMultiplier: number; finished: boolean } {
  if (!Number.isInteger(index) || index < 0 || index >= cards.length) {
    throw new Error("Pick a chip on the table");
  }
  if (revealed.includes(index)) {
    throw new Error("That chip is already flipped");
  }
  const next = [...revealed, index];
  const card = cards[index]!;
  return {
    revealed: next,
    card,
    collectedMultiplier: vaultCollectedMultiplier(cards, next),
    finished: vaultIsFinished(cards, next),
  };
}
