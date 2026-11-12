import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NlheTableEngine } from "@dat-poker/game-engine";
import type { TableConfig } from "@dat-poker/shared";
import { describe, expect, it } from "vitest";
import { freshSitAndGo } from "./sit-and-go.js";
import { loadRoom, saveRoom } from "./table-store.js";

const config: TableConfig = {
  id: "table-keep",
  variant: "nlhe",
  format: "sng",
  maxSeats: 6,
  smallBlindMojos: 10_000n,
  bigBlindMojos: 20_000n,
  minBuyInMojos: 1_500_000n,
  maxBuyInMojos: 1_500_000n,
  rakeBps: 0,
};

describe("table store", () => {
  it("reloads a seated sit-and-go from disk", () => {
    const engine = new NlheTableEngine(config);
    engine.seatPlayer("drew", 0, 1_500_000n);
    engine.seatPlayer("house", 1, 1_500_000n);
    const sng = freshSitAndGo();
    sng.status = "running";
    sng.entrants = 2;
    sng.prizeMojos = 2_000_000n;
    const file = join(mkdtempSync(join(tmpdir(), "dat-poker-")), "tables.json");

    saveRoom(file, {
      tables: [{ id: "table-keep", names: [["drew", "Drew"]], sng, engine: engine.toSnapshot() }],
      buyIns: [
        {
          tableId: "table-keep",
          playerId: "drew",
          record: {
            buyInMojos: "1000000",
            proof: { address: "drew", message: "", signature: "", pubkey: "" },
            recordedAt: "2026-11-12T00:00:00.000Z",
          },
        },
      ],
      withdrawals: [],
    });

    const loaded = loadRoom(file);
    const restored = NlheTableEngine.fromSnapshot(loaded.tables[0].engine);
    expect(restored.getPlayerStack("drew")).toBe(1_500_000n);
    expect(restored.getActivePlayerCount()).toBe(2);
    expect(loaded.tables[0].names).toEqual([["drew", "Drew"]]);
    expect(loaded.tables[0].sng?.prizeMojos).toBe(2_000_000n);
    expect(loaded.tables[0].sng?.status).toBe("running");
    expect(loaded.buyIns[0].record.buyInMojos).toBe("1000000");
  });
});
