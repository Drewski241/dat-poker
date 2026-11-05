import {
  isDrawFamilyVariant,
  isStudFamilyVariant,
  type PokerVariant,
  type TableConfig,
} from "@dat-poker/shared";
import { DrawTableEngine } from "./draw-table.js";
import { NlheTableEngine } from "./nlhe-table.js";
import { StudTableEngine } from "./stud-table.js";

export type TableEngine = NlheTableEngine | DrawTableEngine | StudTableEngine;

export function createTableEngine(config: TableConfig): TableEngine {
  if (isDrawFamilyVariant(config.variant)) {
    return new DrawTableEngine(config);
  }
  if (isStudFamilyVariant(config.variant)) {
    return new StudTableEngine(config);
  }
  return new NlheTableEngine(config);
}

export function engineFamilyForVariant(variant: PokerVariant): "holdem" | "draw" | "stud" {
  if (isDrawFamilyVariant(variant)) return "draw";
  if (isStudFamilyVariant(variant)) return "stud";
  return "holdem";
}
