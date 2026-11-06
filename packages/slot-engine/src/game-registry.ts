import type { SlotGameId } from "@dat-poker/shared";
import {
  evaluateHouseSpin,
  isHouseProgressiveGrid,
  spinHouseGrid,
  defaultHouseEdgeState,
} from "./house-edge.js";
import {
  evaluateMineSpin,
  isMineProgressiveGrid,
  spinMineGrid,
} from "./mine-mojo.js";
import {
  evaluatePokerSpin,
  isPokerProgressiveGrid,
  spinPokerGrid,
} from "./poker-hands.js";
import {
  evaluateSpin,
  isProgressiveJackpotGrid,
  spinGrid,
} from "./slot-engine.js";
import {
  isStampedeProgressiveGrid,
  spinStampedeRound,
} from "./stampede.js";
import type { HouseEdgeState, SlotSpinCore } from "./types.js";
import { winTier } from "./slot-engine.js";

export type { HouseEdgeState };

export function spinForGame(
  gameId: SlotGameId,
  lineBet: number,
  houseState?: HouseEdgeState,
): SlotSpinCore & { nextHouseState?: HouseEdgeState } {
  switch (gameId) {
    case "spirit": {
      const grid = spinGrid();
      return { ...evaluateSpin(grid, lineBet) };
    }
    case "mine-mojo": {
      const grid = spinMineGrid();
      return evaluateMineSpin(grid, lineBet);
    }
    case "poker-hands": {
      const grid = spinPokerGrid();
      return evaluatePokerSpin(grid, lineBet);
    }
    case "spirit-stampede":
      return spinStampedeRound(lineBet);
    case "house-edge": {
      const state = houseState ?? defaultHouseEdgeState();
      const grid = spinHouseGrid(state.bossBonusActive);
      const result = evaluateHouseSpin(grid, lineBet, state);
      const { nextState, ...core } = result;
      return { ...core, nextHouseState: nextState };
    }
    default:
      throw new Error(`Unknown slot game: ${gameId satisfies never}`);
  }
}

export function isProgressiveWin(gameId: SlotGameId, grid: SlotSpinCore["grid"], houseBonus = false): boolean {
  switch (gameId) {
    case "spirit":
      return isProgressiveJackpotGrid(grid as never);
    case "mine-mojo":
      return isMineProgressiveGrid(grid);
    case "poker-hands":
      return isPokerProgressiveGrid(grid);
    case "spirit-stampede":
      return isStampedeProgressiveGrid(grid as never);
    case "house-edge":
      return isHouseProgressiveGrid(grid, houseBonus);
    default:
      return false;
  }
}

export function tierForResult(result: SlotSpinCore): ReturnType<typeof winTier> {
  return winTier(result.totalMultiplier);
}
