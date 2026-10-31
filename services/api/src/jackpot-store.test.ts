import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  contributeToJackpot,
  readProgressiveJackpotMojos,
  reloadJackpotFromDiskForTests,
  resetJackpotForTests,
} from "./jackpot-store.js";

describe("jackpot-store persistence", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dat-jackpot-"));
    process.env.DAT_SLOTS_JACKPOT_PATH = join(dir, "slots-jackpot.json");
    resetJackpotForTests();
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.DAT_SLOTS_JACKPOT_PATH;
  });

  it("writes and reloads progressive jackpot across process restarts", () => {
    resetJackpotForTests(100_000n);
    contributeToJackpot(20_000n, 500); // 5% of 20 DAT = 1 DAT
    expect(readProgressiveJackpotMojos()).toBe(101_000n);

    const raw = readFileSync(join(dir, "slots-jackpot.json"), "utf8");
    expect(JSON.parse(raw).progressiveJackpotMojos).toBe("101000");

    reloadJackpotFromDiskForTests();
    expect(readProgressiveJackpotMojos()).toBe(101_000n);
  });
});
