import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { REEL_STRIPS, type SlotSymbol } from "@dat-poker/game-engine";
import { registerSlotsRoutes } from "./routes/slots.js";
import {
  getSlotsAccount,
  loginSlots,
  normalizeDisplayName,
  resetSlotsAccounts,
  spinSlotsAccount,
} from "./slots-session.js";

function stopForRow(strip: readonly SlotSymbol[], symbol: SlotSymbol, row: number): number {
  const at = strip.indexOf(symbol);
  return (at - row + strip.length) % strip.length;
}

describe("slots session", () => {
  beforeEach(() => {
    resetSlotsAccounts();
  });

  it("normalizes a player name", () => {
    expect(normalizeDisplayName("  June   Park ")).toBe("June Park");
    expect(normalizeDisplayName("A")).toBeNull();
    expect(normalizeDisplayName("no-hyphen")).toBeNull();
  });

  it("pays a scripted seven line and keeps the cane-side bankroll math", () => {
    const created = loginSlots("June");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stops = REEL_STRIPS.map((strip) => stopForRow(strip, "seven", 1));
    let i = 0;
    const spun = spinSlotsAccount(created.account.playerId, 2_000n, {
      nextInt: () => stops[i++]!,
    });
    expect(spun.ok).toBe(true);
    if (!spun.ok) return;
    expect(spun.spin.bigWin).toBe(true);
    expect(spun.account.bankrollMojos).toBe(5_000_000n - 10_000n + 80_000n);
  });

  it("does not debit a bet the demo bankroll cannot cover", () => {
    const created = loginSlots("June", 1_000n);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const spun = spinSlotsAccount(created.account.playerId, 2_000n);
    expect(spun.ok).toBe(false);
    if (spun.ok) return;
    expect(spun.status).toBe(400);
    expect(getSlotsAccount(created.account.playerId)?.bankrollMojos).toBe(1_000n);
  });

  it("logs in and spins over HTTP", async () => {
    const app = Fastify();
    registerSlotsRoutes(app);

    const denied = await app.inject({
      method: "POST",
      url: "/v1/slots/login",
      payload: { displayName: "!" },
    });
    expect(denied.statusCode).toBe(400);

    const login = await app.inject({
      method: "POST",
      url: "/v1/slots/login",
      payload: { displayName: "June" },
    });
    expect(login.statusCode).toBe(200);
    const session = login.json() as {
      playerId: string;
      displayName: string;
      bankrollMojos: string;
      defaultBetPerLineMojos: string;
      lines: number;
      paytable: Array<{ symbol: string; multiplier: number }>;
    };
    expect(session.displayName).toBe("June");
    expect(session.bankrollMojos).toBe("5000000");
    expect(session.lines).toBe(5);
    expect(session.paytable.some((row) => row.symbol === "dat" && row.multiplier === 100)).toBe(true);

    const spin = await app.inject({
      method: "POST",
      url: "/v1/slots/spin",
      payload: {
        playerId: session.playerId,
        betPerLineMojos: session.defaultBetPerLineMojos,
      },
    });
    expect(spin.statusCode).toBe(200);
    const body = spin.json() as {
      grid: string[][];
      totalBetMojos: string;
      payoutMojos: string;
      bankrollMojos: string;
      bigWin: boolean;
    };
    expect(body.grid).toHaveLength(3);
    expect(body.grid[0]).toHaveLength(3);
    expect(BigInt(body.bankrollMojos)).toBe(
      BigInt(session.bankrollMojos) - BigInt(body.totalBetMojos) + BigInt(body.payoutMojos),
    );

    const missing = await app.inject({
      method: "POST",
      url: "/v1/slots/spin",
      payload: { playerId: "slots_missing", betPerLineMojos: "2000" },
    });
    expect(missing.statusCode).toBe(404);
  });
});
