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

export interface PlaySessionState {
  active: boolean;
  tableId?: string;
  stackMojos?: string;
  redeemAvailable: boolean;
  alreadyRedeemedToday?: boolean;
  redeemUtcDay?: string;
  dailyRedeemMojos: string;
  spinCostMojos: string;
  handInProgress?: boolean;
  progressiveJackpotMojos: string;
}

export interface SlotSpinResult {
  ok: boolean;
  spinCostMojos: string;
  lineWinMojos: string;
  progressiveWinMojos: string;
  wonProgressive: boolean;
  netMojos: string;
  stackMojos: string;
  progressiveJackpotMojos: string;
  result: {
    grid: string[][];
    lineWins: unknown[];
    scatterCount: number;
    totalPayoutMojos: string;
    winTier: string;
  };
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

  getPlayConfig: () =>
    request<{
      dailyRedeemMojos: string;
      spinCostMojos: string;
      jackpotContributionBps: number;
      progressiveJackpotMojos: string;
    }>("/v1/play/config"),

  getPlaySession: (playerId: string) =>
    request<PlaySessionState>(`/v1/play/session?playerId=${encodeURIComponent(playerId)}`),

  redeemDailyMessage: (address: string, redeemMojos?: string) => {
    const q = new URLSearchParams({ address });
    if (redeemMojos) q.set("redeemMojos", redeemMojos);
    return request<{ message: string; redeemMojos: string; utcDay: string }>(
      `/v1/play/redeem/message?${q}`,
    );
  },

  redeemDaily: (
    playerId: string,
    options?: { redeemProof?: BuyInProof; devAck?: boolean },
  ) =>
    request<{
      ok: boolean;
      tableId: string;
      stackMojos: string;
      redeemMojos: string;
      alreadyRedeemedToday: boolean;
      spinCostMojos: string;
      progressiveJackpotMojos: string;
      note?: string;
    }>("/v1/play/redeem-daily", {
      method: "POST",
      body: JSON.stringify({ playerId, ...options }),
    }),

  spinSlot: (tableId: string, playerId: string) =>
    request<SlotSpinResult>("/v1/slots/spin", {
      method: "POST",
      body: JSON.stringify({ tableId, playerId }),
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

  getTable: (tableId: string) =>
    request<{
      tableId: string;
      players: number;
      handInProgress: boolean;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
    }>(`/v1/tables/${tableId}`),

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
};
