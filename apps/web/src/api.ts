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
  holeCardCount?: number;
  stackMojos: string;
  betThisStreetMojos: string;
  folded: boolean;
}

export interface HandState {
  handId: string;
  street: string;
  board: { rank: string; suit: string }[];
  potMojos: string;
  currentBetMojos: string;
  actionSeat: number | null;
  players: HandPlayer[];
}

export interface HandResult {
  handId: string;
  winnerId: string;
  potMojos: string;
  reason: "fold" | "showdown";
}

export interface WalletConnectConfig {
  projectId: string;
  chainId: string;
}

export interface DatTokenInfo {
  assetId: string | null;
  ticker: string;
  minBuyInMojos: string;
  devBuyInEnabled: boolean;
  buyInReady: boolean;
}

export interface BuyInProof {
  address: string;
  message: string;
  signature: string;
  pubkey: string;
  datBalanceMojos?: string;
}

export type WithdrawProof = BuyInProof;

export interface WithdrawResult {
  ok: boolean;
  withdrawalId: string;
  stackMojos: string;
  originalBuyInMojos: string;
  payoutMojos: string;
  payoutMode: "net" | "full";
  mode: "ledger" | "offer";
  offer?: string;
  feeMojos: string;
  note: string;
}

export interface TableSeat {
  playerId: string;
  seatIndex: number;
  stackMojos: string;
}

export interface TableConfigResponse {
  id: string;
  variant?: string;
  format?: "cash" | "sng" | "mtt";
  maxSeats?: number;
  minBuyInMojos: string;
  maxBuyInMojos: string;
  smallBlindMojos: string;
  bigBlindMojos: string;
}

export interface SngPlacement {
  playerId: string;
  place: number;
  prizeMojos: string;
}

export interface SngSnapshot {
  status: "registering" | "running" | "finished";
  fillHouse: boolean;
  minHumansToStart: number;
  housePolicy: string;
  maxSeats: number;
  buyInMojos: string;
  startingStackMojos: string;
  prizePoolMojos: string;
  handNumber: number;
  levelIndex: number;
  smallBlindMojos: string;
  bigBlindMojos: string;
  handsPerLevel: number;
  playersRemaining: number;
  humanCount?: number;
  houseSeatsAvailable?: number;
  placements: SngPlacement[];
}

export interface LobbyTable {
  tableId: string;
  format: "cash" | "sng" | "mtt";
  sngStatus: "registering" | "running" | "finished" | null;
  handInProgress: boolean;
  players: number;
  humanCount: number;
  houseSeatsAvailable: number;
  humanPlayerIds?: string[];
  full?: boolean;
  buyInMojos: string;
  smallBlindMojos: string;
  bigBlindMojos: string;
}

export interface TableState {
  tableId: string;
  format?: "cash" | "sng" | "mtt";
  config?: TableConfigResponse;
  players: number;
  handInProgress: boolean;
  seats: TableSeat[];
  hand: HandState | null;
  lastHandResult: HandResult | null;
  sng: SngSnapshot | null;
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  walletConfig: () =>
    request<{
      chiaNetwork: string;
      chainId: string;
      walletConnect: WalletConnectConfig | null;
      withdraw?: {
        payoutMode: "net" | "full";
        treasuryConfigured: boolean;
        feeMojos: string;
      };
    }>("/v1/wallet/config"),

  datToken: () => request<DatTokenInfo>("/v1/wallet/dat-token"),

  buyInMessage: (params: {
    tableId: string;
    seatIndex: number;
    buyInMojos: string;
    address: string;
  }) => {
    const q = new URLSearchParams({
      tableId: params.tableId,
      seatIndex: String(params.seatIndex),
      buyInMojos: params.buyInMojos,
      address: params.address,
    });
    return request<{ message: string }>(`/v1/wallet/buy-in/message?${q}`);
  },

  withdrawMessage: (params: { tableId: string; address: string; stackMojos: string }) => {
    const q = new URLSearchParams({
      tableId: params.tableId,
      address: params.address,
      stackMojos: params.stackMojos,
    });
    return request<{ message: string; stackMojos: string }>(`/v1/wallet/withdraw/message?${q}`);
  },

  withdraw: (
    tableId: string,
    playerId: string,
    options?: { withdrawProof?: WithdrawProof; devAck?: boolean },
  ) =>
    request<WithdrawResult>("/v1/wallet/withdraw", {
      method: "POST",
      body: JSON.stringify({
        tableId,
        playerId,
        ...options,
      }),
    }),

  createTable: (body?: { format?: "cash" | "sng"; fillHouse?: boolean; minHumansToStart?: number }) =>
    request<{ tableId: string; config: TableConfigResponse; sng: SngSnapshot | null }>("/v1/tables", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  getTable: (tableId: string, playerId?: string | null) => {
    const q = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
    return request<TableState>(`/v1/tables/${tableId}${q}`);
  },

  listTables: () => request<{ tables: LobbyTable[] }>("/v1/tables"),

  claimHouse: (
    tableId: string,
    playerId: string,
    buyInMojos: string,
    options?: { seatIndex?: number; buyInProof?: BuyInProof; devAck?: boolean },
  ) =>
    request<TableState & { ok: boolean; replacedPlayerId: string; seatIndex: number; stackMojos: string }>(
      `/v1/tables/${tableId}/claim-house`,
      {
        method: "POST",
        body: JSON.stringify({
          playerId,
          buyInMojos,
          ...options,
        }),
      },
    ),

  seatPlayer: (
    tableId: string,
    playerId: string,
    seatIndex: number,
    buyInMojos: string,
    options?: { buyInProof?: BuyInProof; devAck?: boolean },
  ) =>
    request<{ ok: boolean }>(`/v1/tables/${tableId}/seat`, {
      method: "POST",
      body: JSON.stringify({
        playerId,
        seatIndex,
        buyInMojos,
        ...options,
      }),
    }),

  seatHouse: (tableId: string, buyInMojos: string) =>
    request<{ ok: boolean; playerId: string }>(`/v1/tables/${tableId}/seat-house`, {
      method: "POST",
      body: JSON.stringify({ buyInMojos }),
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

  deal: (tableId: string, playerId?: string) =>
    request<{
      ok: boolean;
      hand: HandState | null;
      lastHandResult: HandResult | null;
      sng?: SngSnapshot | null;
    }>(`/v1/tables/${tableId}/hands/deal`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    }),

  action: (
    tableId: string,
    playerId: string,
    action: PlayerAction,
    amountMojos?: string,
    viewerId?: string,
  ) =>
    request<{
      ok: boolean;
      hand: HandState | null;
      lastHandResult: HandResult | null;
      sng?: SngSnapshot | null;
    }>(`/v1/tables/${tableId}/hands/action`, {
      method: "POST",
      body: JSON.stringify({ playerId, action, amountMojos, viewerId }),
    }),
};
