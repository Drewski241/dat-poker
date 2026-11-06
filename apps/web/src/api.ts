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

export interface CatChannelSnapshot {
  status: "awaiting-signatures" | "active" | "desynced" | "closed";
  sequence: number;
  timeoutBlocks: number;
  aliceAmount: string;
  bobAmount: string;
  lockedMojos: string;
  nonceHex: string;
  assetIdHex: string;
  innerPuzzleHashHex: string;
  catPuzzleHashHex: string;
  coinIdHex: string;
  coinIdSimulated: boolean;
  stateMessageHex: string;
  closeSigningHex: string;
  potato: "alice" | "bob";
  fullSigHolder: "alice" | "bob";
  signed: boolean;
  closeReady: boolean;
  desyncReason?: string;
}

export interface PuzzleCondition {
  opcode: number;
  puzzleHash?: string;
  amount?: string;
  value?: string;
  pubkey?: string;
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

  createTable: (body?: { custody?: "ledger" | "cat-channel"; maxSeats?: number }) =>
    request<{ tableId: string; custody?: string; config: TableConfigResponse }>("/v1/tables", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  getTable: (tableId: string) =>
    request<{
      tableId: string;
      players: number;
      handInProgress: boolean;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
      custody?: string;
      channel?: CatChannelSnapshot | null;
    }>(`/v1/tables/${tableId}`),

  seatPlayer: (
    tableId: string,
    playerId: string,
    seatIndex: number,
    buyInMojos: string,
    options?: { buyInProof?: BuyInProof; devAck?: boolean; channelTest?: boolean },
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

  openCatChannel: (
    tableId: string,
    body: { alicePublicKey: string; alicePayoutPuzzleHash: string; timeoutBlocks?: number },
  ) =>
    request<{ channel: CatChannelSnapshot }>(`/v1/tables/${tableId}/cat-channel/open`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  submitStateSignature: (tableId: string, playerId: string, signature: string) =>
    request<{ channel: CatChannelSnapshot }>(`/v1/tables/${tableId}/cat-channel/state-signature`, {
      method: "POST",
      body: JSON.stringify({ playerId, signature }),
    }),

  submitCloseSignature: (tableId: string, playerId: string, signature: string) =>
    request<{ channel: CatChannelSnapshot }>(`/v1/tables/${tableId}/cat-channel/close-signature`, {
      method: "POST",
      body: JSON.stringify({ playerId, signature }),
    }),

  proveCatChannel: (tableId: string, kind: "close" | "settle" | "preempt") =>
    request<{ kind: string; conditions: PuzzleCondition[] }>(`/v1/tables/${tableId}/cat-channel/prove`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),

  action: (tableId: string, playerId: string, action: PlayerAction, amountMojos?: string) =>
    request<{
      ok: boolean;
      hand: HandState | null;
      lastHandResult: HandResult | null;
      channel?: CatChannelSnapshot | null;
    }>(
      `/v1/tables/${tableId}/hands/action`,
      {
        method: "POST",
        body: JSON.stringify({ playerId, action, amountMojos }),
      },
    ),
};
