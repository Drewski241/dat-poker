import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { serializeForJson } from "./serialize.js";
import { tableView } from "./routes/tables.js";

interface Subscriber {
  socket: WebSocket;
  tableId: string | null;
  playerId: string | null;
}

const subscribers = new Set<Subscriber>();

export function attachTableSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    const subscriber: Subscriber = { socket, tableId: null, playerId: null };
    subscribers.add(subscriber);
    socket.send(JSON.stringify({ type: "connected" }));

    socket.on("message", (raw) => {
      let message: { type?: string; tableId?: string; playerId?: string };
      try {
        message = JSON.parse(String(raw)) as typeof message;
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }
      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (message.type === "subscribe" && message.tableId) {
        subscriber.tableId = message.tableId;
        subscriber.playerId = message.playerId ?? null;
        sendTable(subscriber);
        return;
      }
      socket.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
    });

    socket.on("close", () => subscribers.delete(subscriber));
  });
}

export function publishTable(tableId: string): void {
  for (const subscriber of subscribers) {
    if (subscriber.tableId === tableId) sendTable(subscriber);
  }
}

function sendTable(subscriber: Subscriber): void {
  if (!subscriber.tableId || subscriber.socket.readyState !== WebSocket.OPEN) return;
  const table = tableView(subscriber.tableId, subscriber.playerId);
  if (!table) return;
  subscriber.socket.send(JSON.stringify({ type: "table", table: serializeForJson(table) }));
}
