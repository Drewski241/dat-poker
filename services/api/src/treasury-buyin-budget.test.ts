import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkTreasuryBuyInBudget,
  getTreasuryBuyInBudgetStatus,
  readTreasuryBuyInBudgetConfig,
  recordTreasuryBuyInAllocation,
  resetTreasuryBuyInAllocationsForTests,
} from "./treasury-buyin-budget.js";

describe("treasury buy-in budget", () => {
  afterEach(() => {
    resetTreasuryBuyInAllocationsForTests();
    vi.unstubAllEnvs();
  });

  it("defaults to 10000 DAT (10_000_000 mojos) when treasury funding is enabled", () => {
    vi.stubEnv("DAT_BUYIN_FUNDING", "treasury");
    const config = readTreasuryBuyInBudgetConfig();
    expect(config.enabled).toBe(true);
    expect(config.limitMojos).toBe(10_000_000n);
    expect(config.scope).toBe("global");
  });

  it("tracks global rolling 24h usage", () => {
    vi.stubEnv("DAT_BUYIN_FUNDING", "treasury");
    vi.stubEnv("DAT_TREASURY_DAILY_BUYIN_LIMIT_MOJOS", "10000000");

    recordTreasuryBuyInAllocation(1_000_000n, "xch1player-a");
    recordTreasuryBuyInAllocation(2_000_000n, "xch1player-b");

    const status = getTreasuryBuyInBudgetStatus();
    expect(status?.usedMojos).toBe("3000000");
    expect(status?.remainingMojos).toBe("7000000");
  });

  it("rejects buy-ins that exceed the remaining daily budget", () => {
    vi.stubEnv("DAT_BUYIN_FUNDING", "treasury");
    vi.stubEnv("DAT_TREASURY_DAILY_BUYIN_LIMIT_MOJOS", "2000000");

    recordTreasuryBuyInAllocation(1_500_000n, "xch1player-a");

    expect(checkTreasuryBuyInBudget(1_000_000n, "xch1player-b")).toContain("daily buy-in limit");
    expect(checkTreasuryBuyInBudget(500_000n, "xch1player-b")).toBeNull();
  });

  it("enforces per-player limits when scope is player", () => {
    vi.stubEnv("DAT_BUYIN_FUNDING", "treasury");
    vi.stubEnv("DAT_TREASURY_DAILY_BUYIN_LIMIT_MOJOS", "3000000");
    vi.stubEnv("DAT_TREASURY_DAILY_BUYIN_SCOPE", "player");

    recordTreasuryBuyInAllocation(2_000_000n, "xch1player-a");

    expect(checkTreasuryBuyInBudget(2_000_000n, "xch1player-a")).toContain("daily buy-in limit");
    expect(checkTreasuryBuyInBudget(2_000_000n, "xch1player-b")).toBeNull();
  });
});
