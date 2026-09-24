const apiBase = import.meta.env.VITE_API_URL ?? "";

let authToken: string | null = null;

export function restoreApiAuthToken(): string | null {
  if (authToken) return authToken;
  try {
    const stored = sessionStorage.getItem("dat-poker-auth-v1");
    if (stored) authToken = stored;
  } catch {
    /* private browsing */
  }
  return authToken;
}

export function setApiAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) sessionStorage.setItem("dat-poker-auth-v1", token);
    else sessionStorage.removeItem("dat-poker-auth-v1");
  } catch {
    /* private browsing */
  }
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
  allIn?: boolean;
}

export interface HandState {
  handId: string;
  street: string;
  board: { rank: string; suit: string }[];
  potMojos: string;
  currentBetMojos: string;
  lastRaiseIncrementMojos?: string;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  actionSeat: number | null;
  players: HandPlayer[];
}

export interface HandResult {
  handId: string;
  winnerId: string;
  potMojos: string;
  reason: "fold" | "showdown";
  board?: { rank: string; suit: string }[];
  shown?: {
    playerId: string;
    holeCards: { rank: string; suit: string }[];
    category: string;
  }[];
  participants?: {
    playerId: string;
    totalBetHandMojos: string;
    stackBeforePayoutMojos: string;
  }[];
}

export interface HandHistoryEntry {
  handId: string;
  completedAtMs: number;
  winnerId: string;
  potMojos: string;
  reason: "fold" | "showdown";
  board?: { rank: string; suit: string }[];
  shown?: HandResult["shown"];
  participants: {
    playerId: string;
    totalBetHandMojos: string;
    stackBeforePayoutMojos: string;
    stackAfterMojos: string;
  }[];
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
  remainingStackMojos?: string;
  stillSeated?: boolean;
  unlockedMojos?: string;
  originalBuyInMojos: string;
  payoutMojos: string;
  payoutMode: "net" | "full";
  mode: "ledger" | "offer";
  offer?: string;
  feeMojos: string;
  accountMojos?: string;
  playthrough?: PlaythroughInfo;
  note: string;
}

export interface PlaythroughInfo {
  poolMojos: string;
  handsPlayed: number;
  handsRequired: number;
  unlockedMojos: string;
  playthroughRemaining: number;
}

export interface TableSeat {
  playerId: string;
  seatIndex: number;
  stackMojos: string;
  displayAddress?: string;
  handsPlayed?: number;
  handsRequired?: number;
  playthroughRemaining?: number;
  unlockedMojos?: string;
}

export interface TableConfigResponse {
  id: string;
  minBuyInMojos: string;
  maxBuyInMojos: string;
  smallBlindMojos: string;
  bigBlindMojos: string;
}

export interface SngSnapshot {
  status: "registering" | "running" | "finished";
  maxSeats: number;
  buyInMojos: string;
  prizePoolMojos: string;
  payouts?: { place: number; bps: number; prizeMojos: string }[];
  handNumber: number;
  smallBlindMojos: string;
  bigBlindMojos: string;
  nextSmallBlindMojos?: string | null;
  nextBigBlindMojos?: string | null;
  levelIndex?: number;
  levelCount?: number;
  handsPerLevel?: number;
  levelDurationMs?: number;
  startedAtMs?: number | null;
  nextLevelAtMs?: number | null;
  blindsUpNextHand?: boolean;
  handsUntilNextLevel?: number | null;
  playersRemaining: number;
  humanCount: number;
  houseSeatsAvailable: number;
  placements: { playerId: string; place: number; prizeMojos: string }[];
}

export interface LobbyTable {
  tableId: string;
  format?: "cash" | "sng" | "mtt";
  sng?: SngSnapshot | null;
  sngStatus?: string | null;
  handInProgress: boolean;
  players: number;
  humans?: number;
  humanCount?: number;
  houseSeatsAvailable?: number;
  humanPlayerIds?: string[];
  full?: boolean;
  maxSeats?: number;
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
      playthrough?: PlaythroughInfo;
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

  linkSage: (body: { address: string; nonce: string; signature: string; pubkey: string }) =>
    request<{
      ok: boolean;
      token: string;
      playerId: string;
      address: string;
      expiresInSeconds: number;
    }>("/v1/session/link", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  terms: () =>
    request<{
      ok: boolean;
      version: string;
      effectiveDate: string;
      acceptanceValidDays: number;
      content: string;
    }>("/v1/auth/terms"),

  playRequirements: () =>
    request<{
      ok: boolean;
      complianceRequired: boolean;
      turnstileSiteKey: string;
      minAge: number;
      blockedCountryCodes: string[];
      emailDeliveryMode: "memory" | "log" | "smtp";
      emailDeliversToInbox: boolean;
    }>("/v1/auth/play-requirements"),

  geoHint: () => request<{ ok: boolean; countryCode: string | null }>("/v1/auth/geo-hint"),

  register: (
    body: {
      username: string;
      password: string;
      email: string;
      countryCode: string;
      ageConfirmed: boolean;
      turnstileToken?: string;
      termsAccepted: boolean;
      termsVersion: string;
    },
  ) =>
    request<{
      ok: boolean;
      needsEmailVerification?: boolean;
      message?: string;
      token?: string;
      playerId: string;
      username: string;
      email: string;
      emailVerified: boolean;
      sageLinked: boolean;
      sageAddress: string;
      betaVerificationCode?: string;
    }>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  verifyEmail: (
    body: {
      username: string;
      code: string;
      countryCode: string;
      ageConfirmed: boolean;
      turnstileToken?: string;
      termsAccepted: boolean;
      termsVersion: string;
    },
  ) =>
    request<{
      ok: boolean;
      message: string;
      token: string;
      playerId: string;
      username: string;
      email: string;
      emailVerified: boolean;
      sageLinked: boolean;
      sageAddress: string;
    }>("/v1/auth/email/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resendVerificationEmail: (body: { username: string; email: string }) =>
    request<{ ok: boolean; message: string; betaVerificationCode?: string }>("/v1/auth/email/resend", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addEmailToAccount: (
    body: {
      username: string;
      password: string;
      email: string;
      countryCode: string;
      ageConfirmed: boolean;
      turnstileToken?: string;
      termsAccepted: boolean;
      termsVersion: string;
    },
  ) =>
    request<{
      ok: boolean;
      needsEmailVerification?: boolean;
      message?: string;
      username: string;
      email: string;
    }>("/v1/auth/email/add", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (
    body: {
      username: string;
      password: string;
      countryCode: string;
      ageConfirmed: boolean;
      turnstileToken?: string;
      termsAccepted: boolean;
      termsVersion: string;
    },
  ) =>
    request<{
      ok: boolean;
      token: string;
      playerId: string;
      username: string;
      email: string;
      emailVerified: boolean;
      sageLinked: boolean;
      sageAddress: string;
    }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  me: () =>
    request<{
      ok: boolean;
      playerId: string;
      username: string;
      email: string;
      emailVerified: boolean;
      sageLinked: boolean;
      sageAddress: string;
    }>("/v1/auth/me"),

  forgotPassword: (body: { username: string; email: string }) =>
    request<{
      ok: boolean;
      message: string;
      expiresInSeconds?: number;
    }>("/v1/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resetPassword: (body: { username: string; resetCode: string; password: string }) =>
    request<{ ok: boolean; message: string }>("/v1/auth/password/reset", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  changePassword: (body: { currentPassword: string; password: string }) =>
    request<{ ok: boolean; message: string }>("/v1/auth/password/change", {
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
      playthrough?: PlaythroughInfo;
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

  withdrawMessage: (params: {
    tableId?: string;
    address: string;
    stackMojos: string;
    fromAccount?: boolean;
  }) => {
    const q = new URLSearchParams({
      address: params.address,
      stackMojos: params.stackMojos,
    });
    if (params.tableId) q.set("tableId", params.tableId);
    if (params.fromAccount) q.set("fromAccount", "1");
    return request<{ message: string; stackMojos: string }>(`/v1/wallet/withdraw/message?${q}`);
  },

  withdraw: (
    tableId: string | null,
    playerId: string,
    options?: { withdrawProof?: WithdrawProof; devAck?: boolean; toAccount?: boolean; fromAccount?: boolean },
  ) =>
    request<WithdrawResult>("/v1/wallet/withdraw", {
      method: "POST",
      body: JSON.stringify({
        tableId: tableId ?? undefined,
        playerId,
        ...options,
      }),
    }),

  lobbyPresence: () =>
    request<{ seatedHumans: number; humansInHand: number; tableCount: number }>(
      "/v1/lobby/presence",
    ),

  createTable: (body?: { format?: "cash" | "sng"; fillHouse?: boolean; minHumansToStart?: number }) =>
    request<{ tableId: string; config: TableConfigResponse; sng?: SngSnapshot | null }>("/v1/tables", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  listTables: () =>
    request<{ tables: LobbyTable[] }>("/v1/tables"),

  joinSng: (
    playerId: string,
    buyInMojos: string,
    options?: { buyInProof?: BuyInProof; devAck?: boolean },
  ) =>
    request<{
      ok: boolean;
      tableId: string;
      maxSeats: number;
      format?: string;
      humans?: number;
      handInProgress: boolean;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
      sng?: SngSnapshot | null;
    }>("/v1/tables/join-sng", {
      method: "POST",
      body: JSON.stringify({
        playerId,
        buyInMojos,
        ...options,
      }),
    }),

  claimHouse: (
    tableId: string,
    playerId: string,
    buyInMojos: string,
    options?: { seatIndex?: number; buyInProof?: BuyInProof; devAck?: boolean },
  ) =>
    request<{
      ok: boolean;
      tableId: string;
      seats: TableSeat[];
      hand: HandState | null;
      sng?: SngSnapshot | null;
      handInProgress: boolean;
    }>(`/v1/tables/${tableId}/claim-house`, {
      method: "POST",
      body: JSON.stringify({
        playerId,
        buyInMojos,
        ...options,
      }),
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
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
      dealerButtonSeat?: number | null;
    }>("/v1/tables/join", {
      method: "POST",
      body: JSON.stringify({
        playerId,
        buyInMojos,
        ...options,
      }),
    }),

  getHandHistory: (tableId: string, playerId?: string, limit = 20) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (playerId) q.set("playerId", playerId);
    return request<{ tableId: string; hands: HandHistoryEntry[] }>(
      `/v1/tables/${tableId}/hand-history?${q}`,
    );
  },

  getTable: (tableId: string, playerId?: string) =>
    request<{
      tableId: string;
      format?: "cash" | "sng" | "mtt";
      maxSeats?: number;
      players: number;
      humans?: number;
      handInProgress: boolean;
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
      dealerButtonSeat?: number | null;
      sng?: SngSnapshot | null;
      playthrough?: PlaythroughInfo | null;
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

  rebuyTable: (
    tableId: string,
    playerId: string,
    buyInMojos: string,
    options?: { buyInProof?: BuyInProof; devAck?: boolean },
  ) =>
    request<{
      ok: boolean;
      rebuy: boolean;
      tableId: string;
      maxSeats: number;
      humans: number;
      handInProgress: boolean;
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      seats: TableSeat[];
      hand: HandState | null;
      lastHandResult: HandResult | null;
      dealerButtonSeat?: number | null;
    }>(`/v1/tables/${tableId}/rebuy`, {
      method: "POST",
      body: JSON.stringify({
        playerId,
        buyInMojos,
        ...options,
      }),
    }),

  goHand: (tableId: string, playerId: string) =>
    request<{
      ok: boolean;
      handId: string;
      commitHash: string;
      hand: HandState | null;
      lastHandResult: HandResult | null;
      playthrough?: PlaythroughInfo | null;
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
    request<{
      ok: boolean;
      hand: HandState | null;
      lastHandResult: HandResult | null;
      sng?: SngSnapshot | null;
      playthrough?: PlaythroughInfo | null;
    }>(
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
