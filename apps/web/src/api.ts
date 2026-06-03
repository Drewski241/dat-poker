const apiBase = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return body;
}

export type PlayerAction = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface HandPlayer {
  playerId: string;
  seatIndex: number;
  holeCards: { rank: string; suit: string }[];
  stackMojos: string;
  folded: boolean;
}

export interface HandState {
  handId: string;
  street: string;
  board: { rank: string; suit: string }[];
  potMojos: string;
  actionSeat: number | null;
  players: HandPlayer[];
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  createTable: () =>
    request<{ tableId: string }>("/v1/tables", { method: "POST", body: "{}" }),

  getTable: (tableId: string) =>
    request<{ tableId: string; players: number; hand: HandState | null }>(
      `/v1/tables/${tableId}`,
    ),

  seatPlayer: (tableId: string, playerId: string, seatIndex: number, buyInMojos: string) =>
    request<{ ok: boolean }>(`/v1/tables/${tableId}/seat`, {
      method: "POST",
      body: JSON.stringify({ playerId, seatIndex, buyInMojos }),
    }),

  startHand: (tableId: string) =>
    request<{ handId: string; commitHash: string; phase: string }>(
      `/v1/tables/${tableId}/hands/start`,
      { method: "POST", body: "{}" },
    ),

  submitSeed: (tableId: string, playerId: string) =>
    request<{ ok: boolean }>(`/v1/tables/${tableId}/hands/seed`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    }),

  deal: (tableId: string) =>
    request<{ ok: boolean; hand: HandState }>(`/v1/tables/${tableId}/hands/deal`, {
      method: "POST",
      body: "{}",
    }),

  action: (tableId: string, playerId: string, action: PlayerAction, amountMojos?: string) =>
    request<{ ok: boolean; hand: HandState | null }>(`/v1/tables/${tableId}/hands/action`, {
      method: "POST",
      body: JSON.stringify({ playerId, action, amountMojos }),
    }),
};
