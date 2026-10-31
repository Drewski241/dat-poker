import { DAT_PLAY_DEFAULTS } from "@dat-poker/shared";

let progressiveJackpotMojos = DAT_PLAY_DEFAULTS.jackpotSeedMojos;

export function readProgressiveJackpotMojos(): bigint {
  return progressiveJackpotMojos;
}

export function contributeToJackpot(spinCostMojos: bigint, contributionBps: number): void {
  progressiveJackpotMojos += (spinCostMojos * BigInt(contributionBps)) / 10_000n;
}

export function payoutProgressiveJackpot(): bigint {
  const amount = progressiveJackpotMojos;
  progressiveJackpotMojos = DAT_PLAY_DEFAULTS.jackpotSeedMojos;
  return amount;
}

export function resetJackpotForTests(seed = DAT_PLAY_DEFAULTS.jackpotSeedMojos): void {
  progressiveJackpotMojos = seed;
}
