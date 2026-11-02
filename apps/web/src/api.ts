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

  siteDat: (address: string) =>
    request<SiteDatBalance>(`/v1/wallet/site-dat?address=${encodeURIComponent(address)}`),

  siteRedeemMessage: (address: string, amountMojos: string, nonce: string) => {
    const q = new URLSearchParams({ address, amountMojos, nonce });
    return request<{ message: string }>(`/v1/wallet/site-dat/redeem/message?${q}`);
  },

  redeemSiteDat: (body: {
    address: string;
    amountMojos: string;
    nonce: string;
    proof: BuyInProof;
  }) =>
    request<{ ok: boolean; balanceMojos: string }>("/v1/wallet/site-dat/redeem", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createTournament: (body: {
    format: "sng" | "mtt";
    buyInMojos: string;
    maxEntries?: number;
  }) =>
    request<TournamentView>("/v1/tournaments", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  fillHouse: (tournamentId: string, seats?: number) =>
    request<TournamentView>(`/v1/tournaments/${tournamentId}/fill-house`, {
      method: "POST",
      body: JSON.stringify(seats == null ? {} : { seats }),
    }),

  settleTournament: (tournamentId: string, body: { playerWinsAddress: string }) =>
    request<TournamentView>(`/v1/tournaments/${tournamentId}/settle`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getTournament: (tournamentId: string) =>
    request<TournamentView>(`/v1/tournaments/${tournamentId}`),

  tournamentJoinMessage: (tournamentId: string, address: string, custody: TournamentCustody) => {
    const q = new URLSearchParams({ address, custody });
    return request<{ message: string; puzzleHash: string; buyInMojos: string }>(
      `/v1/tournaments/${tournamentId}/join/message?${q}`,
    );
  },

  joinTournament: (
    tournamentId: string,
    body: { address: string; custody: TournamentCustody; proof: BuyInProof },
  ) =>
    request<TournamentView>(`/v1/tournaments/${tournamentId}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  tournamentLockMessage: (tournamentId: string, entryId: string, coinId: string) =>
    request<{ message: string }>(
      `/v1/tournaments/${tournamentId}/entries/${entryId}/lock/message?coinId=${coinId}`,
    ),

  lockTournamentCoin: (
    tournamentId: string,
    entryId: string,
    body: { coinId: string; proof: BuyInProof },
  ) =>
    request<TournamentView>(`/v1/tournaments/${tournamentId}/entries/${entryId}/lock`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  cancelTournament: (tournamentId: string) =>
    request<TournamentView>(`/v1/tournaments/${tournamentId}/cancel`, {
      method: "POST",
      body: "{}",
    }),
};

export type TournamentCustody = "pool_coin" | "site_ledger";

export interface SiteDatBalance {
  address: string;
  balanceMojos: string;
  redeemedMojos: string;
  redeemEnabled: boolean;
  maxRedeemMojos: string;
  capMojos: string;
  note: string;
}

export interface TournamentEntryView {
  entryId: string;
  address: string;
  puzzleHash: string;
  custody: TournamentCustody;
  house: boolean;
  status: string;
  coinId?: string;
  innerPuzzleHash?: string;
  catPuzzleHash?: string | null;
}

export interface TournamentView {
  id: string;
  format: "sng" | "mtt";
  buyInMojos: string;
  maxEntries: number;
  fieldLabel: string;
  payoutBasis: number | null;
  paidPlaces: number;
  payoutBps: number[];
  payoutNote: string;
  houseCount: number;
  houseMojos: string;
  refundAfterSeconds: number;
  status: string;
  prizePoolMojos: string;
  lockedPoolMojos: string;
  siteLedgerMojos: string;
  custodyNote: string;
  entries: TournamentEntryView[];
  siteCredits?: Array<{ address: string; amountMojos: string }>;
  spends?: Array<{
    entryId: string;
    address: string;
    timeoutRefund?: { solutionHex: string };
    immediateRefund?: { authorizerMessage: string | null };
    settle?: {
      solutionHex: string;
      authorizerMessage: string | null;
      outputs: Array<{ puzzleHash: string; amountMojos: string }>;
    };
  }>;
}
