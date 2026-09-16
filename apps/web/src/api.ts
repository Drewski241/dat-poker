const apiBase = import.meta.env.VITE_API_URL ?? "";

let authToken: string | null = null;

export function setApiAuthToken(token: string | null): void {
  authToken = token;
}

export function getApiAuthToken(): string | null {
  return authToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (authToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${authToken}`);
  }
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
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
  dailyRedeemMojos?: string;
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
  accountMojos?: string;
  note: string;
}

export interface TableSeat {
  playerId: string;
  seatIndex: number;
  stackMojos: string;
  displayAddress?: string;
  handsPlayed?: number;
  handsRequired?: number;
  playthroughRemaining?: number;
}

export interface TableConfigResponse {
  id: string;
  minBuyInMojos: string;
  maxBuyInMojos: string;
  smallBlindMojos: string;
  bigBlindMojos: string;
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

  account: (address: string) =>
    request<{
      address: string;
      playerId?: string;
      balanceMojos: string;
      dailyRedeemMojos: string;
      redeemedToday: boolean;
      nextRedeemAt: string;
    }>(`/v1/wallet/account?address=${encodeURIComponent(address)}`),

  sessionChallenge: (address: string) =>
    request<{ nonce: string; message: string; expiresAt: string; note?: string }>(
      `/v1/session/challenge?address=${encodeURIComponent(address)}`,
    ),

  createSession: (body: { address: string; nonce: string; signature: string; pubkey: string }) =>
    request<{
      ok: boolean;
      token: string;
      playerId: string;
      address: string;
      expiresInSeconds: number;
    }>("/v1/session", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  redeemMessage: (address: string) =>
    request<{ message: string; utcDate: string; amountMojos: string }>(
      `/v1/wallet/redeem/message?address=${encodeURIComponent(address)}`,
    ),

  redeem: (playerId: string, options?: { redeemProof?: BuyInProof; devAck?: boolean }) =>
    request<{
      ok: boolean;
      creditedMojos: string;
      balanceMojos: string;
      ticker: string;
      nextRedeemAt: string;
      note: string;
    }>("/v1/wallet/redeem", {
      method: "POST",
      body: JSON.stringify({ playerId, ...options }),
    }),

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

  createTable: () =>
    request<{ tableId: string; config: TableConfigResponse }>("/v1/tables", {
      method: "POST",
      body: "{}",
    }),

  joinTable: (
    playerId: string,
    buyInMojos: string,
    options?: { buyInProof?: BuyInProof; devAck?: boolean },
  ) =>
    request<{
      ok: boolean;
      tableId: string;
      maxSeats: number;
      humans: number;
      handInProgress: boolean;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
    }>("/v1/tables/join", {
      method: "POST",
      body: JSON.stringify({
        playerId,
        buyInMojos,
        ...options,
      }),
    }),

  getTable: (tableId: string, playerId?: string) =>
    request<{
      tableId: string;
      maxSeats?: number;
      players: number;
      humans?: number;
      handInProgress: boolean;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
    }>(`/v1/tables/${tableId}${playerId ? `?playerId=${encodeURIComponent(playerId)}` : ""}`),

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

  goHand: (tableId: string, playerId: string) =>
    request<{
      ok: boolean;
      handId: string;
      commitHash: string;
      hand: HandState | null;
      lastHandResult: HandResult | null;
    }>(`/v1/tables/${tableId}/hands/go`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    }),

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
    request<{ ok: boolean; hand: HandState | null; lastHandResult: HandResult | null }>(
      `/v1/tables/${tableId}/hands/action`,
      {
        method: "POST",
        body: JSON.stringify({ playerId, action, amountMojos }),
      },
    ),

  submitFeedback: (body: {
    comment: string;
    contact?: string;
    page?: string;
    images?: { name?: string; type?: string; dataBase64: string }[];
  }) =>
    request<{ ok: boolean; id: string; imageCount: number; note: string }>("/v1/feedback", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
