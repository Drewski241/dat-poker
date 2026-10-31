import { randomUUID } from "node:crypto";
import type { TableConfig } from "@dat-poker/shared";
import { DAT_TABLE_DEFAULTS, resolveDatDailyRedeemMojos } from "@dat-poker/shared";
import { resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { NlheTableEngine } from "@dat-poker/game-engine";
import { readDatTokenConfig } from "./wallet-config.js";

const tables = new Map<string, NlheTableEngine>();

export function getTablesMap(): Map<string, NlheTableEngine> {
  return tables;
}

export function createSpiritTable(): { tableId: string; engine: NlheTableEngine; config: TableConfig } {
  const id = randomUUID();
  const dat = readDatTokenConfig();
  const useDatStakes = Boolean(dat.assetId) || dat.devBuyInEnabled;
  const dailyRedeem = resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS);
  const minBuyIn = useDatStakes ? dailyRedeem : DAT_TABLE_DEFAULTS.minBuyInMojos;

  const config: TableConfig = {
    id,
    variant: "nlhe",
    format: "cash",
    maxSeats: 6,
    smallBlindMojos: useDatStakes ? DAT_TABLE_DEFAULTS.smallBlindMojos : 50_000_000_000n,
    bigBlindMojos: useDatStakes ? DAT_TABLE_DEFAULTS.bigBlindMojos : 100_000_000_000n,
    minBuyInMojos: minBuyIn,
    maxBuyInMojos: useDatStakes ? 100_000_000n : 20_000_000_000_000n,
    rakeBps: 500,
  };

  const engine = new NlheTableEngine(config);
  tables.set(id, engine);
  return { tableId: id, engine, config };
}

export function resolveConfiguredDailyRedeemMojos(): bigint {
  return resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS);
}

export function resolveConfiguredMinBuyInMojos(): bigint {
  const dat = readDatTokenConfig();
  if (dat.assetId || dat.devBuyInEnabled) {
    return resolveConfiguredDailyRedeemMojos();
  }
  return resolveDatMinBuyInMojos(process.env.DAT_MIN_BUY_IN_MOJOS);
}
