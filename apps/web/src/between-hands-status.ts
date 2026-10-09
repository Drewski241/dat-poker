import { DAT_MTT_DEFAULTS } from "@dat-poker/shared";
import type { SngSnapshot } from "./api.js";

export const AUTO_DEAL_DELAY_MS = 3_000;
export const AUTO_DEAL_AFTER_RESULT_MS = 4_000;
/** Shown while the field is still registering or tables are being redrawn. */
export const TOURNAMENT_WAIT_TICK_MS = 1_000;

function formatCountdown(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function mttFieldLabel(sng: SngSnapshot): string {
  const size = sng.fieldSize ?? sng.maxSeats;
  if (size === DAT_MTT_DEFAULTS.fieldSize) {
    return `${size}-player Sit-n-Go`;
  }
  return `${size}-player MTT`;
}

export function betweenHandsStatusMessage(input: {
  nowMs: number;
  tableFormat: "cash" | "sng" | "mtt" | string;
  autoDeal: boolean;
  autoDealAtMs: number | null;
  sng: SngSnapshot | null;
  sittingOut: boolean;
  busy: boolean;
  canAutoDeal: boolean;
  /** Active players who can be dealt in; used for clearer stall messages. */
  activeDealSeats?: number;
}): string | null {
  if (input.sittingOut) {
    if (input.tableFormat === "sng" || input.tableFormat === "mtt") {
      return "Sitting out — tournament continues; you check/fold until you bust.";
    }
    return "Sitting out — tap Sit in when you want the next hand.";
  }
  if (input.busy) {
    return "Working…";
  }

  const tourney = input.tableFormat === "sng" || input.tableFormat === "mtt";

  if (tourney && input.sng?.status === "registering") {
    const deadline = input.autoDealAtMs;
    if (deadline != null) {
      return `Seating the field… tournament starts in ${formatCountdown(deadline - input.nowMs)}`;
    }
    return "Seating the field…";
  }

  if (tourney && input.sng?.pauseDeals) {
    const deadline = input.autoDealAtMs;
    if (input.sng.pendingFinalTable) {
      return deadline != null
        ? `Waiting for other tables… final table in ${formatCountdown(deadline - input.nowMs)}`
        : "Waiting for other tables before the final table…";
    }
    return deadline != null
      ? `Redrawing tables… next hand in ${formatCountdown(deadline - input.nowMs)}`
      : "Redrawing tables…";
  }

  if (input.autoDeal && input.canAutoDeal && input.autoDealAtMs != null) {
    return `Next hand in ${formatCountdown(input.autoDealAtMs - input.nowMs)}`;
  }

  if (input.autoDeal && input.canAutoDeal) {
    return "Next hand dealing…";
  }

  if (input.autoDeal && tourney && input.sng?.status === "running") {
    if (input.activeDealSeats != null && input.activeDealSeats < 2) {
      return "Need two active players to deal the next hand…";
    }
    return "Waiting for the next hand…";
  }

  if (input.autoDeal && input.tableFormat === "cash") {
    return "Next hand dealing…";
  }

  return null;
}
