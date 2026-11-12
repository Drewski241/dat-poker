import type { HandResult, HandState, TableSeat, TournamentInfo } from "./api.js";

export interface LiveTable {
  tableId: string;
  hand: HandState | null;
  seats: TableSeat[];
  handInProgress: boolean;
  buttonSeat: number | null;
  tournament: TournamentInfo | null;
  lastHandResult: HandResult | null;
}

/** Push updates for one table. Returns a function that closes the socket. */
export function subscribeTable(
  tableId: string,
  playerId: () => string | null,
  onTable: (table: LiveTable) => void,
): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retry: number | null = null;

  const connect = () => {
    if (stopped) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const next = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socket = next;
    next.onopen = () => {
      next.send(JSON.stringify({ type: "subscribe", tableId, playerId: playerId() }));
    };
    next.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; table?: LiveTable };
        if (message.type === "table" && message.table?.tableId === tableId) onTable(message.table);
      } catch {
        /* ignore a malformed push */
      }
    };
    next.onclose = () => {
      if (!stopped) retry = window.setTimeout(connect, 1000);
    };
  };

  connect();
  return () => {
    stopped = true;
    if (retry != null) window.clearTimeout(retry);
    socket?.close();
  };
}
