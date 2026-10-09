import type { DatTokenInfo, LobbyTable } from "../api.js";
import { formatDatAmount, formatDatMojos } from "@dat-poker/shared";
import type { MttEventSummary } from "../lobby-mtt.js";

type Props = {
  event: MttEventSummary;
  datToken: DatTokenInfo | null;
  playerId: string | null;
  busy: boolean;
  buyInReady: boolean;
  playerLabel: (id: string, youId: string | null) => string;
  onBack: () => void;
  onJoinAsPlayer: () => void;
  onResumeTable: (tableId: string) => void;
  onTakeHouseSeat: (row: LobbyTable) => void;
};

export function MttEventLobby({
  event,
  datToken,
  playerId,
  busy,
  buyInReady,
  playerLabel,
  onBack,
  onJoinAsPlayer,
  onResumeTable,
  onTakeHouseSeat,
}: Props) {
  return (
    <div className="lobby mtt-event-lobby">
      <button type="button" className="secondary mtt-event-lobby-back" disabled={busy} onClick={onBack}>
        ← Back to lobby
      </button>
      <h3>{event.label}</h3>
      <p className="muted small">
        {event.tableCount} tables · {event.humanCount} human{event.humanCount === 1 ? "" : "s"} ·{" "}
        {event.status} · buy-in {formatDatMojos(event.buyInMojos, datToken?.ticker)} · pool{" "}
        {formatDatMojos(event.prizePoolMojos, datToken?.ticker)} · blinds{" "}
        {formatDatAmount(event.smallBlindMojos)}/{formatDatAmount(event.bigBlindMojos)}
      </p>
      <div className="row mtt-event-lobby-actions">
        {event.myTableId ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onResumeTable(event.myTableId!)}
          >
            Return to my table
          </button>
        ) : (
          <button type="button" disabled={busy || !playerId || !buyInReady} onClick={onJoinAsPlayer}>
            Join {event.label} (take a seat)
          </button>
        )}
      </div>
      <p className="muted small">
        Join as player replaces one house bot with you. Browse tables below to pick a specific table, or use
        Join to auto-seat.
      </p>
      <ul className="lobby-list">
        {event.tables.map((row) => {
          const humans = row.humanCount ?? row.humans ?? 0;
          const house = row.houseSeatsAvailable ?? 0;
          const full = Boolean(row.full) || house === 0;
          const imHere = Boolean(playerId && row.humanPlayerIds?.includes(playerId));
          return (
            <li key={row.tableId}>
              <span>
                {row.sng?.tableLabel ?? row.tableId}
                {" · "}
                {humans} human{humans === 1 ? "" : "s"}
                {row.humanPlayerIds?.length
                  ? ` (${row.humanPlayerIds.map((id) => playerLabel(id, playerId)).join(", ")})`
                  : ""}
                {" · "}
                {full ? "full" : `${house} house`}
                {row.handInProgress ? " · hand in progress" : ""}
              </span>
              {imHere ? (
                <button type="button" disabled={busy} onClick={() => onResumeTable(row.tableId)}>
                  Open my seat
                </button>
              ) : full ? (
                <span className="muted small">Full</span>
              ) : (
                <button
                  type="button"
                  disabled={busy || !playerId || !buyInReady || row.handInProgress}
                  onClick={() => onTakeHouseSeat(row)}
                >
                  {row.handInProgress ? "Wait for hand" : "Take house seat"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
