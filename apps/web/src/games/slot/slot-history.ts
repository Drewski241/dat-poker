import { formatDatMojos, type SlotGameId } from "@dat-poker/shared";
import { paylineDisplayName } from "./SlotPaylineOverlay.js";
import { symbolDisplay } from "./symbol-display.js";

export type SlotHistoryEntry = {
  id: string;
  at: string;
  gameId: SlotGameId;
  betMojos: string;
  lineWinMojos: string;
  progressiveWinMojos: string;
  netMojos: string;
  wonProgressive: boolean;
  freeSpin: boolean;
  drawPhase: boolean;
  lineWins: { lineIndex: number; symbol: string; count: number; multiplier: number }[];
  waysWins: { symbol: string; reelCount: number; ways: number; multiplier: number; phase?: string }[];
  scatterCount: number;
  scatterMultiplier: number;
  cascadeSteps: number;
  expandingWild: boolean;
};

function formatMult(multiplier: number): string {
  return String(Math.round(multiplier * 100) / 100);
}

/** The same win breakdown the banner shows, kept so a later spin can still be read. */
export function formatSlotHistoryEntry(entry: SlotHistoryEntry, ticker: string): string {
  const parts: string[] = [];
  if (entry.drawPhase) parts.push("Draw");
  if (entry.freeSpin) parts.push("Boss free spin");
  if (entry.cascadeSteps > 0) {
    parts.push(`${entry.cascadeSteps} cascade${entry.cascadeSteps === 1 ? "" : "s"}`);
  }
  if (entry.expandingWild) parts.push("Expanding wild respin");
  for (const win of entry.lineWins) {
    const name = symbolDisplay(entry.gameId, win.symbol).label;
    parts.push(`${paylineDisplayName(win.lineIndex)}: ${name} ×${win.count} (${formatMult(win.multiplier)}×)`);
  }
  const phased = entry.waysWins.some((way) => way.phase === "respin");
  const fmtWay = (way: SlotHistoryEntry["waysWins"][number]) => {
    const name = symbolDisplay(entry.gameId, way.symbol).label;
    const wayWord = way.ways === 1 ? "way" : "ways";
    return `${name} ${way.reelCount}-reel · ${way.ways} ${wayWord} (${formatMult(way.multiplier)}×)`;
  };
  if (phased) {
    const opening = entry.waysWins.filter((way) => way.phase !== "respin");
    const respin = entry.waysWins.filter((way) => way.phase === "respin");
    if (opening.length > 0) parts.push(`Opening: ${opening.map(fmtWay).join(" · ")}`);
    if (respin.length > 0) parts.push(`Respin: ${respin.map(fmtWay).join(" · ")}`);
  } else {
    for (const way of entry.waysWins) parts.push(fmtWay(way));
  }
  if (entry.scatterCount >= 3 && entry.scatterMultiplier > 0) {
    parts.push(`Scatter ×${entry.scatterCount} (${formatMult(entry.scatterMultiplier)}×)`);
  }
  if (entry.wonProgressive) parts.push("Progressive jackpot");
  const gross = BigInt(entry.lineWinMojos || "0") + BigInt(entry.progressiveWinMojos || "0");
  const detail = parts.filter((part) => part !== "Draw" && part !== "Boss free spin");
  if (gross <= 0n && detail.length === 0) {
    return entry.drawPhase ? "Draw — No win this spin." : "No win this spin.";
  }
  const net = BigInt(entry.netMojos || "0");
  const netLabel =
    net >= 0n ? `Net +${formatDatMojos(net.toString(), ticker)}` : `Net ${formatDatMojos(net.toString(), ticker)}`;
  return `${parts.join(" · ")} — Won ${formatDatMojos(gross.toString(), ticker)} · ${netLabel}`;
}
