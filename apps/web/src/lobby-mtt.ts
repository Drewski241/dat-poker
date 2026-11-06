import type { LobbyTable } from "./api.js";
import { mttFieldLabel } from "./between-hands-status.js";

export type MttEventSummary = {
  eventId: string;
  label: string;
  status: string;
  buyInMojos: string;
  prizePoolMojos: string;
  smallBlindMojos: string;
  bigBlindMojos: string;
  fieldSize: number;
  tableCount: number;
  humanCount: number;
  myTableId: string | null;
  tables: LobbyTable[];
};

export function groupLobbyTables(
  rows: LobbyTable[],
  playerId: string | null,
): { mttEvents: MttEventSummary[]; sngRows: LobbyTable[] } {
  const active = rows.filter(
    (row) => (row.format === "sng" || row.format === "mtt") && row.sng?.status !== "finished",
  );
  const sngRows = active.filter((row) => row.format === "sng" || row.sng?.kind !== "mtt");
  const mttRows = active.filter((row) => row.format === "mtt" && row.sng?.kind === "mtt");

  const byEvent = new Map<string, LobbyTable[]>();
  for (const row of mttRows) {
    const eventId = row.sng?.eventId ?? row.tableId;
    const list = byEvent.get(eventId) ?? [];
    list.push(row);
    byEvent.set(eventId, list);
  }

  const mttEvents: MttEventSummary[] = [...byEvent.entries()].map(([eventId, tables]) => {
    const sample = tables[0]!.sng!;
    const humanCount = tables.reduce((sum, row) => sum + (row.humanCount ?? row.humans ?? 0), 0);
    let myTableId: string | null = null;
    if (playerId) {
      for (const row of tables) {
        if (row.humanPlayerIds?.includes(playerId)) {
          myTableId = row.tableId;
          break;
        }
      }
    }
    const fieldSize = sample.fieldSize ?? tables.length * (sample.maxSeats ?? 8);
    return {
      eventId,
      label: mttFieldLabel(sample),
      status: sample.status,
      buyInMojos: sample.buyInMojos,
      prizePoolMojos: sample.prizePoolMojos,
      smallBlindMojos: sample.smallBlindMojos,
      bigBlindMojos: sample.bigBlindMojos,
      fieldSize,
      tableCount: tables.length,
      humanCount,
      myTableId,
      tables: tables.sort((a, b) =>
        (a.sng?.tableLabel ?? a.tableId).localeCompare(b.sng?.tableLabel ?? b.tableId, undefined, {
          numeric: true,
        }),
      ),
    };
  });

  mttEvents.sort((a, b) => a.label.localeCompare(b.label));

  return { mttEvents, sngRows };
}
