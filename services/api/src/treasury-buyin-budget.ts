import { datTokensToMojos } from "@dat-poker/shared";
import { readBuyInFunding } from "./wallet-config.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_LIMIT_DAT = 10_000n;

export type TreasuryBuyInBudgetScope = "global" | "player";

export interface TreasuryBuyInBudgetConfig {
  enabled: boolean;
  limitMojos: bigint;
  scope: TreasuryBuyInBudgetScope;
  windowHours: number;
}

export interface TreasuryBuyInBudgetStatus {
  limitMojos: string;
  usedMojos: string;
  remainingMojos: string;
  scope: TreasuryBuyInBudgetScope;
  windowHours: number;
}

interface TreasuryBuyInAllocation {
  playerId: string;
  amountMojos: bigint;
  recordedAtMs: number;
}

const allocations: TreasuryBuyInAllocation[] = [];

export function readTreasuryBuyInBudgetConfig(): TreasuryBuyInBudgetConfig {
  const enabled = readBuyInFunding() === "treasury";
  const rawLimit = process.env.DAT_TREASURY_DAILY_BUYIN_LIMIT_MOJOS?.trim();
  const limitMojos = rawLimit ? BigInt(rawLimit) : datTokensToMojos(DEFAULT_DAILY_LIMIT_DAT);
  const scope =
    process.env.DAT_TREASURY_DAILY_BUYIN_SCOPE === "player" ? "player" : "global";

  return {
    enabled,
    limitMojos,
    scope,
    windowHours: 24,
  };
}

function pruneExpired(nowMs = Date.now()): void {
  const cutoff = nowMs - WINDOW_MS;
  for (let i = allocations.length - 1; i >= 0; i -= 1) {
    if (allocations[i]!.recordedAtMs < cutoff) {
      allocations.splice(i, 1);
    }
  }
}

function sumUsedMojos(scope: TreasuryBuyInBudgetScope, playerId?: string, nowMs = Date.now()): bigint {
  pruneExpired(nowMs);
  const cutoff = nowMs - WINDOW_MS;
  return allocations.reduce((sum, entry) => {
    if (entry.recordedAtMs < cutoff) return sum;
    if (scope === "player" && entry.playerId !== playerId) return sum;
    return sum + entry.amountMojos;
  }, 0n);
}

export function getTreasuryBuyInBudgetStatus(playerId?: string): TreasuryBuyInBudgetStatus | null {
  const config = readTreasuryBuyInBudgetConfig();
  if (!config.enabled) return null;

  const usedMojos = sumUsedMojos(config.scope, playerId);
  const remainingMojos = config.limitMojos > usedMojos ? config.limitMojos - usedMojos : 0n;

  return {
    limitMojos: config.limitMojos.toString(),
    usedMojos: usedMojos.toString(),
    remainingMojos: remainingMojos.toString(),
    scope: config.scope,
    windowHours: config.windowHours,
  };
}

export function checkTreasuryBuyInBudget(
  buyInMojos: bigint,
  playerId: string,
): string | null {
  const config = readTreasuryBuyInBudgetConfig();
  if (!config.enabled) return null;

  const usedMojos = sumUsedMojos(config.scope, playerId);
  if (usedMojos + buyInMojos > config.limitMojos) {
    const remainingMojos = config.limitMojos > usedMojos ? config.limitMojos - usedMojos : 0n;
    const scopeLabel = config.scope === "player" ? "your wallet" : "treasury";
    return `Treasury daily buy-in limit reached for ${scopeLabel} (remaining ${remainingMojos.toString()} mojos in rolling 24h window)`;
  }

  return null;
}

export function recordTreasuryBuyInAllocation(buyInMojos: bigint, playerId: string): void {
  const config = readTreasuryBuyInBudgetConfig();
  if (!config.enabled) return;

  allocations.push({
    playerId,
    amountMojos: buyInMojos,
    recordedAtMs: Date.now(),
  });
  pruneExpired();
}

/** Test helper — clears in-memory allocation ledger. */
export function resetTreasuryBuyInAllocationsForTests(): void {
  allocations.length = 0;
}
