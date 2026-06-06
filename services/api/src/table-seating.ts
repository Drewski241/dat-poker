import type { NlheTableEngine } from "@dat-poker/game-engine";
import { resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { recordBuyIn } from "./buy-in-store.js";
import {
  checkTreasuryBuyInBudget,
  recordTreasuryBuyInAllocation,
} from "./treasury-buyin-budget.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "./wallet-config.js";

export interface SeatPlayerParams {
  tableId: string;
  playerId: string;
  seatIndex: number;
  buyInMojos: string;
  buyInProof?: BuyInProof;
  devAck?: boolean;
}

export type SeatPlayerResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function seatPlayerWithBuyIn(
  table: NlheTableEngine,
  params: SeatPlayerParams,
): SeatPlayerResult {
  const dat = readDatTokenConfig();
  const buyInMojos = BigInt(params.buyInMojos);
  const minBuyIn = resolveDatMinBuyInMojos(dat.minBuyInMojos);

  if (buyInMojos < minBuyIn) {
    return {
      ok: false,
      status: 400,
      error: `Buy-in below minimum (${minBuyIn.toString()} mojos)`,
    };
  }

  const treasuryFundedBuyIn = dat.buyInFunding === "treasury";

  if (treasuryFundedBuyIn) {
    if (!dat.assetId) {
      return { ok: false, status: 503, error: "DAT token not configured for treasury buy-in" };
    }
    const budgetError = checkTreasuryBuyInBudget(buyInMojos, params.playerId);
    if (budgetError) {
      return { ok: false, status: 429, error: budgetError };
    }
  } else if (!dat.devBuyInEnabled) {
    if (!dat.assetId) {
      return { ok: false, status: 503, error: "DAT token not configured" };
    }
    if (!params.buyInProof) {
      return { ok: false, status: 400, error: "Wallet buy-in proof required" };
    }
    const proofError = validateBuyInProof(params.buyInProof, {
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos,
      playerId: params.playerId,
    });
    if (proofError) {
      return { ok: false, status: 400, error: proofError };
    }
    if (params.buyInProof.datBalanceMojos) {
      const balance = BigInt(params.buyInProof.datBalanceMojos);
      if (balance < buyInMojos) {
        return { ok: false, status: 400, error: "Insufficient DAT balance for buy-in" };
      }
    }
  } else if (!params.devAck && dat.assetId && params.buyInProof) {
    const proofError = validateBuyInProof(params.buyInProof, {
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos,
      playerId: params.playerId,
    });
    if (proofError) {
      return { ok: false, status: 400, error: proofError };
    }
  }

  const buyInProof = params.buyInProof ?? {
    address: params.playerId,
    message: "",
    signature: "",
    pubkey: "",
  };
  recordBuyIn(params.tableId, params.playerId, buyInProof, params.buyInMojos, {
    treasuryFunded: treasuryFundedBuyIn,
  });
  if (treasuryFundedBuyIn) {
    recordTreasuryBuyInAllocation(buyInMojos, params.playerId);
  }

  try {
    table.seatPlayer(params.playerId, params.seatIndex, buyInMojos);
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 400, error: (e as Error).message };
  }
}
