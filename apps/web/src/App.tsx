import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAT_MOJOS_PER_TOKEN, computeNlheBetRange, DAT_TABLE_DEFAULTS, formatDatAmount, formatDatMojos, isHousePlayerId } from "@dat-poker/shared";
import {
  api,
  restoreApiAuthToken,
  setApiAuthToken,
  type BuyInProof,
  type DatTokenInfo,
  type HandHistoryEntry,
  type HandResult,
  type HandState,
  type PlayerAction,
  type PlaythroughInfo,
  type LobbyTable,
  type SngSnapshot,
  type TableSeat,
  type WithdrawResult,
} from "./api.js";
import { AuthPanel, ChangePasswordForm } from "./AuthPanel.js";
import { CardRow } from "./components/PlayingCard.js";
import { LuckyIrishWin } from "./components/LuckyIrishWin.js";
import { HunterBullseyeWin } from "./components/HunterBullseyeWin.js";
import { TableRoom } from "./components/TableRoom.js";
import { HandHistoryModal } from "./components/HandHistoryModal.js";
import { YourTurnSloth } from "./components/YourTurnSloth.js";
import { allInBettingClosed, isCallAllIn, shouldHoldTableForRunout, shouldPlayAllInRunout } from "./all-in-runout.js";
import { sngShouldAutoDeal } from "./sng-auto-deal.js";
import { describeLiveHand } from "./live-hand.js";
import {
  actionSecondsRemaining,
  autoActionOnTimeout,
  PLAYER_ACTION_LIMIT_MS,
  shouldShowSloth,
  turnTimerKey,
} from "./player-turn-timer.js";
import {
  pickBigWinOverlay,
  readStoredBigWinOverlay,
  shouldCelebrateBigWin,
  type BigWinOverlay,
} from "./lucky-irish.js";
import { QrConnectModal } from "./components/QrConnectModal.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";
import {
  beginWalletConnect,
  disconnectWallet,
  loadPlayerWallet,
  mapWalletConnectError,
  restoreSession,
  signRedeemMessage,
  signWithdrawMessage,
  type WcSession,
} from "./wallet/chia-wallet.js";

const HOUSE_PLAYER_ID = "dat-poker:house";
const DAT_BIG_BLIND_MOJOS = DAT_TABLE_DEFAULTS.bigBlindMojos;
const CARD_PREVIEW_BOARD = [
  { rank: "A", suit: "h" },
  { rank: "K", suit: "h" },
  { rank: "Q", suit: "s" },
  { rank: "J", suit: "d" },
  { rank: "T", suit: "c" },
];
const CARD_PREVIEW_HOLE = [
  { rank: "A", suit: "s" },
  { rank: "9", suit: "h" },
];
const CARD_PREVIEW_HAND = describeLiveHand(CARD_PREVIEW_HOLE, CARD_PREVIEW_BOARD);

function seatPositionLabel(
  seatIndex: number,
  hand: HandState | null,
  dealerButtonSeat: number | null,
): string {
  if (hand) {
    if (hand.dealerSeat === seatIndex) return " · dealer";
    if (hand.smallBlindSeat === seatIndex) return " · small blind";
    if (hand.bigBlindSeat === seatIndex) return " · big blind";
    return "";
  }
  if (dealerButtonSeat === seatIndex) return " · dealer (next hand)";
  return "";
}

function playerLabel(id: string, youId: string | null, display?: string): string {
  if (id === youId) return "You";
  if (isHousePlayerId(id)) {
    if (id === HOUSE_PLAYER_ID) return "House";
    const seat = id.split(":").pop();
    return `House ${seat ?? ""}`.trim();
  }
  const shown = display && display.length > 0 ? display : id;
  return shown.length > 16 ? `${shown.slice(0, 8)}…${shown.slice(-6)}` : shown;
}

function shortAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

const VERIFY_PENDING_STORAGE_KEY = "dat-poker-verify-pending-v1";

function readVerifyPending(): { username: string; email: string } | null {
  try {
    const raw = sessionStorage.getItem(VERIFY_PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: string; email?: string };
    if (parsed.username?.trim() && parsed.email?.trim()) {
      return { username: parsed.username.trim(), email: parsed.email.trim() };
    }
  } catch {
    /* private browsing */
  }
  return null;
}

function writeVerifyPending(pending: { username: string; email: string } | null): void {
  try {
    if (pending) sessionStorage.setItem(VERIFY_PENDING_STORAGE_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(VERIFY_PENDING_STORAGE_KEY);
  } catch {
    /* private browsing */
  }
}

export function App({ onNavigate }: { onNavigate?: (next: SitePage) => void } = {}) {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [datToken, setDatToken] = useState<DatTokenInfo | null>(null);
  const [wcConfig, setWcConfig] = useState<{ projectId: string; chainId: string } | null>(null);
  const [withdrawConfig, setWithdrawConfig] = useState<{
    treasuryConfigured: boolean;
    treasuryReachable: boolean;
    treasuryHost: string | null;
    treasuryError: string | null;
    treasuryWalletRpcReachable: boolean | null;
    onChainPayoutEnabled: boolean;
  } | null>(null);

  const [session, setSession] = useState<WcSession | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const pairingGen = useRef(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [datBalance, setDatBalance] = useState<string | null>(null);
  const [accountMojos, setAccountMojos] = useState<string | null>(null);
  const [accountPlaythrough, setAccountPlaythrough] = useState<PlaythroughInfo | null>(null);
  const [redeemedToday, setRedeemedToday] = useState(false);

  const [tableId, setTableId] = useState<string | null>(null);
  const [tableFormat, setTableFormat] = useState<"cash" | "sng" | "mtt">("cash");
  const [tableMaxSeats, setTableMaxSeats] = useState(6);
  const [sng, setSng] = useState<SngSnapshot | null>(null);
  const [lobbyTables, setLobbyTables] = useState<LobbyTable[]>([]);
  /** When seated: full-screen table vs lobby (account, withdraw, leave). */
  const [tableFocusMode, setTableFocusMode] = useState(true);
  const [tableSeats, setTableSeats] = useState<TableSeat[]>([]);
  const [dealerButtonSeat, setDealerButtonSeat] = useState<number | null>(null);
  const [handInProgress, setHandInProgress] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<WithdrawResult | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hand, setHand] = useState<HandState | null>(null);
  const [handResult, setHandResult] = useState<HandResult | null>(null);
  const [runoutFromBoardLen, setRunoutFromBoardLen] = useState<number | null>(null);
  const liveHandMeta = useRef({
    handId: "",
    boardLen: 0,
    allIn: false,
    allInPlayerIds: [] as string[],
    viewerFolded: false,
    bettingClosed: false,
  });
  const runoutFromBoardLenRef = useRef<number | null>(null);
  const holdTableForRunoutRef = useRef(false);
  const playedRunouts = useRef(new Set<string>());
  const [handHistory, setHandHistory] = useState<HandHistoryEntry[]>([]);
  const [handHistoryOpen, setHandHistoryOpen] = useState(false);
  const [bigWin, setBigWin] = useState<BigWinOverlay | null>(null);
  const celebratedHandId = useRef<string | null>(null);
  const lastBigWin = useRef<BigWinOverlay | null>(readStoredBigWinOverlay());
  const handForTimerRef = useRef(hand);
  const playerIdForTimerRef = useRef(playerId);
  const [cardPreview, setCardPreview] = useState(false);
  const [slothPreview, setSlothPreview] = useState(false);
  const [turnElapsedMs, setTurnElapsedMs] = useState(0);
  const turnTimeoutFiredRef = useRef<string | null>(null);
  const sendActionRef = useRef<(action: PlayerAction, amountMojos?: string) => void>(() => {});
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [betAmountMojos, setBetAmountMojos] = useState<bigint>(DAT_BIG_BLIND_MOJOS);
  const [bigBlindMojos, setBigBlindMojos] = useState<bigint>(DAT_BIG_BLIND_MOJOS);
  const [verificationPending, setVerificationPending] = useState<{ username: string; email: string } | null>(
    () => readVerifyPending(),
  );
  const [lobbyPresence, setLobbyPresence] = useState<{
    seatedHumans: number;
    humansInHand: number;
  } | null>(null);

  useEffect(() => {
    writeVerifyPending(verificationPending);
  }, [verificationPending]);
  const [smallBlindMojos, setSmallBlindMojos] = useState<bigint>(DAT_TABLE_DEFAULTS.smallBlindMojos);

  useEffect(() => {
    void (async () => {
      restoreApiAuthToken();
      try {
        await api.health();
        setApiOk(true);
      } catch {
        setApiOk(false);
        return;
      }
      try {
        const [config, dat] = await Promise.all([api.walletConfig(), api.datToken()]);
        setDatToken(dat);
        if (config.withdraw) {
          setWithdrawConfig({
            treasuryConfigured: Boolean(config.withdraw.treasuryConfigured),
            treasuryReachable: Boolean(config.withdraw.treasuryReachable),
            treasuryHost: config.withdraw.treasuryHost ?? null,
            treasuryError: config.withdraw.treasuryError ?? null,
            treasuryWalletRpcReachable: config.withdraw.treasuryWalletRpcReachable ?? null,
            onChainPayoutEnabled: Boolean(config.withdraw.onChainPayoutEnabled),
          });
        }
        if (restoreApiAuthToken()) {
          try {
            const me = await api.me();
            setPlayerId(me.playerId);
            setUsername(me.username);
            if (me.sageAddress) setWalletAddress(me.sageAddress);
            const acc = await api.account(me.playerId);
            setAccountMojos(acc.balanceMojos);
            setRedeemedToday(acc.redeemedToday);
            setAccountPlaythrough(acc.playthrough ?? null);
          } catch {
            setApiAuthToken(null);
          }
        }
        if (config.walletConnect) {
          setWcConfig(config.walletConnect);
          try {
            const existing = await restoreSession(config.walletConnect.projectId);
            if (existing) {
              setSession(existing);
              try {
                const loaded = await loadPlayerWallet(
                  existing,
                  config.walletConnect.projectId,
                  config.walletConnect.chainId,
                  dat.assetId,
                );
                setWalletAddress(loaded.address);
                setDatBalance(loaded.balance.spendable);
              } catch {
                /* pairing is enough; Link Sage can still fill the address */
              }
            }
          } catch {
            /* Stale WalletConnect storage must not mark the API offline — Connect Sage still works. */
          }
        }
      } catch {
        /* Wallet config / DAT token / Sage restore failures must not block account sign-up. */
      }
    })();
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      const raw = (e as Error).message || "Request failed";
      setError(
        /timeout|aborted/i.test(raw)
          ? "Withdraw timed out waiting for treasury. On the AWS host, confirm Sage RPC :9257 is logged in, then try again."
          : raw,
      );
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshTreasuryStatus = useCallback(async () => {
    const config = await api.walletConfig();
    if (config.withdraw) {
      setWithdrawConfig({
        treasuryConfigured: Boolean(config.withdraw.treasuryConfigured),
        treasuryReachable: Boolean(config.withdraw.treasuryReachable),
        treasuryHost: config.withdraw.treasuryHost ?? null,
        treasuryError: config.withdraw.treasuryError ?? null,
        treasuryWalletRpcReachable: config.withdraw.treasuryWalletRpcReachable ?? null,
        onChainPayoutEnabled: Boolean(config.withdraw.onChainPayoutEnabled),
      });
    }
  }, []);

  const refreshAccount = useCallback(async (address: string) => {
    const acc = await api.account(address);
    setAccountMojos(acc.balanceMojos);
    setRedeemedToday(acc.redeemedToday);
    setAccountPlaythrough(acc.playthrough ?? null);
  }, []);

  const refreshTable = useCallback(async (id: string) => {
    let t = await api.getTable(id, playerId ?? undefined);
    if (t.sng?.relocatedToTableId && t.sng.relocatedToTableId !== id) {
      setTableId(t.sng.relocatedToTableId);
      t = await api.getTable(t.sng.relocatedToTableId, playerId ?? undefined);
    }
    setHand(t.hand);
    setTableSeats(t.seats);
    setHandInProgress(t.handInProgress);
    setDealerButtonSeat(t.dealerButtonSeat ?? null);
    if (t.format) setTableFormat(t.format);
    if (t.maxSeats) setTableMaxSeats(t.maxSeats);
    setSng(t.sng ?? null);
    if (t.sng?.status === "finished" && playerId && !t.seats.some((s) => s.playerId === playerId)) {
      const hold = holdTableForRunoutRef.current || shouldHoldTableForRunout(
        { ...liveHandMeta.current, viewerId: playerId },
        t.lastHandResult ?? null,
        runoutFromBoardLenRef.current != null,
        Boolean(t.lastHandResult && playedRunouts.current.has(t.lastHandResult.handId)),
      );
      if (!hold) setTableFocusMode(false);
    }
    if (t.smallBlindMojos) {
      try {
        const sb = BigInt(t.smallBlindMojos);
        if (sb > 0n) setSmallBlindMojos(sb);
      } catch {
        /* keep current blinds */
      }
    }
    if (t.bigBlindMojos) {
      try {
        const bb = BigInt(t.bigBlindMojos);
        if (bb > 0n) setBigBlindMojos(bb);
      } catch {
        /* keep current blinds */
      }
    }
    if (t.lastHandResult) setHandResult(t.lastHandResult);
    if (t.playthrough) setAccountPlaythrough(t.playthrough);
    if (t.accountMojos) setAccountMojos(t.accountMojos);
    if (playerId) {
      try {
        const hist = await api.getHandHistory(id, playerId);
        setHandHistory(hist.hands);
      } catch {
        /* history optional */
      }
    }
  }, [playerId]);

  const applyActionResponse = useCallback(
    (response: {
      hand: HandState | null;
      lastHandResult: HandResult | null;
      sng?: SngSnapshot | null;
      playthrough?: PlaythroughInfo | null;
    }) => {
      setHand(response.hand);
      if (response.lastHandResult) setHandResult(response.lastHandResult);
      if (response.sng !== undefined) setSng(response.sng);
      if (response.playthrough) setAccountPlaythrough(response.playthrough);
    },
    [],
  );

  useEffect(() => {
    if (!tableId) return;
    const timer = window.setInterval(() => {
      void refreshTable(tableId);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [tableId, refreshTable]);

  const atTableRoom = Boolean(tableId && tableFocusMode && playerId);

  useEffect(() => {
    if (!apiOk || atTableRoom) return;
    const load = () => {
      void api.lobbyPresence().then(
        (p) => setLobbyPresence({ seatedHumans: p.seatedHumans, humansInHand: p.humansInHand }),
        () => setLobbyPresence(null),
      );
      void api.listTables().then(
        (res) => setLobbyTables(res.tables),
        () => setLobbyTables([]),
      );
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [apiOk, atTableRoom, tableId, handInProgress]);

  useEffect(() => {
    if (sng?.status !== "finished" || !playerId) return;
    void refreshAccount(playerId);
  }, [sng?.status, playerId, refreshAccount]);

  useEffect(() => {
    runoutFromBoardLenRef.current = runoutFromBoardLen;
  }, [runoutFromBoardLen]);

  useEffect(() => {
    if (hand) {
      const sameHand = liveHandMeta.current.handId === hand.handId;
      const allInIds = hand.players.filter((p) => p.allIn && !p.folded).map((p) => p.playerId);
      const me = playerId ? hand.players.find((p) => p.playerId === playerId) : undefined;
      const viewerAllIn = Boolean(me?.allIn && !me.folded) || (sameHand && liveHandMeta.current.allIn);
      const bettingClosed = allInBettingClosed(hand.players);
      liveHandMeta.current = {
        handId: hand.handId,
        // Freeze the board only when no two remaining players can still bet.
        boardLen:
          bettingClosed && sameHand ? liveHandMeta.current.boardLen : hand.board.length,
        allIn: viewerAllIn,
        allInPlayerIds: sameHand
          ? [...new Set([...liveHandMeta.current.allInPlayerIds, ...allInIds])]
          : allInIds,
        viewerFolded: Boolean(me?.folded),
        bettingClosed,
      };
      return;
    }
    if (!handResult || playedRunouts.current.has(handResult.handId)) return;
    if (!shouldPlayAllInRunout({ ...liveHandMeta.current, viewerId: playerId }, handResult)) return;
    holdTableForRunoutRef.current = true;
    playedRunouts.current.add(handResult.handId);
    setRunoutFromBoardLen(
      typeof handResult.runoutFromBoardLen === "number"
        ? handResult.runoutFromBoardLen
        : liveHandMeta.current.boardLen,
    );
  }, [hand, handResult, playerId]);

  useEffect(() => {
    if (hand || handInProgress) {
      setTableFocusMode(true);
    }
  }, [hand, handInProgress]);

  const cancelPairing = () => {
    pairingGen.current += 1;
    setPairingOpen(false);
    setWcUri(null);
    setPairingError(null);
    setBusy(false);
    setStatus("");
  };

  const connectSage = () => {
    if (!wcConfig) {
      setError("WalletConnect not configured on API (.env WALLETCONNECT_PROJECT_ID)");
      return;
    }
    const gen = ++pairingGen.current;
    setBusy(true);
    setError(null);
    setWcUri(null);
    setPairingError(null);
    setPairingOpen(true);
    setStatus("Connecting to WalletConnect…");
    void (async () => {
      try {
        const { uri, approval } = await beginWalletConnect({
          ...wcConfig,
          onUri: (nextUri) => {
            if (pairingGen.current !== gen) return;
            setWcUri(nextUri);
            setPairingError(null);
            setStatus("Scan the QR with Sage…");
          },
        });
        if (pairingGen.current !== gen) return;
        setWcUri(uri);
        setPairingError(null);
        setStatus("Scan the QR with Sage…");
        const next = await approval();
        if (pairingGen.current !== gen) return;
        setSession(next);
        setPairingOpen(false);
        setWcUri(null);
        setPairingError(null);
        try {
          const loaded = await loadPlayerWallet(
            next,
            wcConfig.projectId,
            wcConfig.chainId,
            datToken?.assetId,
          );
          setWalletAddress(loaded.address);
          setDatBalance(loaded.balance.spendable);
        } catch {
          /* Link Sage still works if the address read fails */
        }
        setStatus("Sage paired. Link the address if withdraw still asks for it.");
      } catch (e) {
        if (pairingGen.current !== gen) return;
        const message = mapWalletConnectError(e).message;
        setPairingError(message);
        setError(message);
        setWcUri(null);
        setStatus("");
      } finally {
        if (pairingGen.current === gen) setBusy(false);
      }
    })();
  };

  const disconnectSage = () =>
    run("Disconnecting Sage…", async () => {
      if (session && wcConfig) {
        await disconnectWallet(session, wcConfig.projectId);
      }
      setSession(null);
      setWalletAddress(null);
      setDatBalance(null);
      setStatus("");
    });

  const signOut = () =>
    run("Signing out…", async () => {
      if (session && wcConfig) {
        await disconnectWallet(session, wcConfig.projectId);
      }
      setSession(null);
      setWalletAddress(null);
      setDatBalance(null);
      setAccountMojos(null);
      setAccountPlaythrough(null);
      setRedeemedToday(false);
      setPlayerId(null);
      setUsername(null);
      setStatus("");
      setTableId(null);
      setTableSeats([]);
      setHand(null);
      setHandResult(null);
      setApiAuthToken(null);
    });

  const handleAuth = (
    mode: "register" | "login",
    fields: {
      username: string;
      password: string;
      email?: string;
      countryCode: string;
      ageConfirmed: boolean;
      turnstileToken?: string;
      termsAccepted: boolean;
      termsVersion: string;
    },
  ) => {
    void run(mode === "register" ? "Creating account…" : "Signing in…", async () => {
      if (mode === "register") {
        if (!fields.email?.trim()) {
          throw new Error("Email is required");
        }
        const registered = await api.register({
          username: fields.username,
          password: fields.password,
          email: fields.email.trim(),
          countryCode: fields.countryCode,
          ageConfirmed: fields.ageConfirmed,
          turnstileToken: fields.turnstileToken,
          termsAccepted: fields.termsAccepted,
          termsVersion: fields.termsVersion,
        });
        setVerificationPending({ username: registered.username, email: registered.email });
        const codeHint = registered.betaVerificationCode
          ? ` Code (beta): ${registered.betaVerificationCode}`
          : "";
        setStatus((registered.message ?? "Check your email for a verification code.") + codeHint);
        return;
      }
      const result = await api.login({
        username: fields.username,
        password: fields.password,
        countryCode: fields.countryCode,
        ageConfirmed: fields.ageConfirmed,
        turnstileToken: fields.turnstileToken,
        termsAccepted: fields.termsAccepted,
        termsVersion: fields.termsVersion,
      });
      if (!result.token) {
        throw new Error("Sign-in failed");
      }
      setVerificationPending(null);
      setApiAuthToken(result.token);
      setPlayerId(result.playerId);
      setUsername(result.username);
      if (result.sageAddress) setWalletAddress(result.sageAddress);
      await refreshAccount(result.playerId);
    });
  };

  const handleVerifyEmail = async (fields: {
    username: string;
    code: string;
    countryCode: string;
    ageConfirmed: boolean;
    turnstileToken?: string;
    termsAccepted: boolean;
    termsVersion: string;
  }) => {
    setBusy(true);
    setError(null);
    setStatus("Verifying email…");
    try {
      const result = await api.verifyEmail(fields);
      setVerificationPending(null);
      setApiAuthToken(result.token);
      setPlayerId(result.playerId);
      setUsername(result.username);
      if (result.sageAddress) setWalletAddress(result.sageAddress);
      await refreshAccount(result.playerId);
      setStatus(result.message);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const handleAddEmail = async (fields: {
    username: string;
    password: string;
    email: string;
    countryCode: string;
    ageConfirmed: boolean;
    turnstileToken?: string;
    termsAccepted: boolean;
    termsVersion: string;
  }) => {
    await run("Adding email…", async () => {
      const result = await api.addEmailToAccount(fields);
      setVerificationPending({ username: result.username, email: result.email });
      setStatus(result.message ?? "Check your email for a verification code.");
    });
  };

  const handleResendVerification = async (fields: { username: string; email: string }) => {
    setBusy(true);
    setError(null);
    try {
      return await api.resendVerificationEmail(fields);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (fields: { username: string; email: string }) => {
    setBusy(true);
    setError(null);
    setStatus("Sending reset email…");
    try {
      const result = await api.forgotPassword(fields);
      setStatus(result.message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const handleReset = async (fields: { username: string; resetCode: string; password: string }) => {
    setBusy(true);
    setError(null);
    setStatus("Updating password…");
    try {
      const result = await api.resetPassword(fields);
      setStatus(result.message);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (fields: { currentPassword: string; password: string }) => {
    setBusy(true);
    setError(null);
    setStatus("Updating password…");
    try {
      const result = await api.changePassword(fields);
      setStatus(result.message);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const linkSageWallet = () =>
    run("Linking Sage…", async () => {
      if (!session || !wcConfig) {
        throw new Error("Connect Sage first");
      }
      if (!playerId) throw new Error("Sign in first");
      const { balance, address } = await loadPlayerWallet(
        session,
        wcConfig.projectId,
        wcConfig.chainId,
        datToken?.assetId,
      );
      setWalletAddress(address);
      setStatus("Approve a withdraw-link signature in Sage — this cannot send coins…");
      const challenge = await api.sessionChallenge(address);
      const signed = await signRedeemMessage(
        session,
        wcConfig.projectId,
        wcConfig.chainId,
        challenge.message,
        address,
      );
      const linked = await api.linkSage({
        address,
        nonce: challenge.nonce,
        signature: signed.signature,
        pubkey: signed.pubkey,
      });
      setApiAuthToken(linked.token);
      setPlayerId(linked.playerId);
      setDatBalance(balance.spendable);
      await refreshAccount(linked.playerId);
      setStatus("Sage address linked. You can withdraw unlocked DAT.");
    });

  const redeemDaily = () =>
    run("Redeeming 5000 DAT…", async () => {
      if (!playerId) throw new Error("Create an account or sign in first");
      const result = await api.redeem(playerId, {
        devAck: datToken?.devBuyInEnabled ?? true,
      });
      setAccountMojos(result.balanceMojos);
      setRedeemedToday(true);
      if (result.playthrough) setAccountPlaythrough(result.playthrough);
      await refreshAccount(playerId);
      setStatus(result.note);
    });

  const joinTable = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!playerId) throw new Error("Create an account or sign in first");
      const ticker = datToken?.ticker ?? "DAT";
      const buyIn = datToken?.minBuyInMojos ?? "1000000";
      const account = BigInt(accountMojos ?? "0");
      const sage = BigInt(datBalance ?? "0");
      if (account < BigInt(buyIn) && sage < BigInt(buyIn) && !datToken?.devBuyInEnabled) {
        throw new Error(`Redeem ${formatDatMojos(datToken?.dailyRedeemMojos ?? "5000000", ticker)} today, then buy in`);
      }

      setStatus("Joining 6-max table…");
      const joined = await api.joinTable(playerId, buyIn, {
        devAck: datToken?.devBuyInEnabled,
      });
      setTableId(joined.tableId);
      setTableFormat("cash");
      setTableMaxSeats(joined.maxSeats ?? 6);
      setSng(null);
      setTableFocusMode(true);
      setTableSeats(joined.seats);
      setHand(joined.hand);
      setHandInProgress(joined.handInProgress);
      setDealerButtonSeat(joined.dealerButtonSeat ?? null);
      if (joined.smallBlindMojos) {
        try {
          const sb = BigInt(joined.smallBlindMojos);
          if (sb > 0n) setSmallBlindMojos(sb);
        } catch {
          /* keep default blinds */
        }
      }
      if (joined.bigBlindMojos) {
        try {
          const bb = BigInt(joined.bigBlindMojos);
          if (bb > 0n) setBigBlindMojos(bb);
        } catch {
          /* keep default blinds */
        }
      }
      if (joined.lastHandResult) setHandResult(joined.lastHandResult);
      await refreshAccount(playerId);
      const humans = joined.humans;
      setStatus(
        humans >= 2
          ? "Seated with another player. Deal when everyone is ready."
          : "Seated vs house. Another human can take an empty seat.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const joinMtt = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!playerId) throw new Error("Create an account or sign in first");
      const buyIn = datToken?.minBuyInMojos ?? "1000000";
      setStatus("Joining 16-player sit-n-go…");
      const joined = await api.joinMtt(playerId, buyIn, {
        devAck: datToken?.devBuyInEnabled,
      });
      setTableId(joined.tableId);
      setTableFormat("mtt");
      setTableMaxSeats(joined.maxSeats ?? 8);
      setSng(joined.sng ?? null);
      setTableFocusMode(true);
      setTableSeats(joined.seats);
      setHand(joined.hand);
      setHandInProgress(joined.handInProgress);
      await refreshAccount(playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const joinSng = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!playerId) throw new Error("Create an account or sign in first");
      const buyIn = datToken?.minBuyInMojos ?? "1000000";
      setStatus("Joining 9-max sit-n-go…");
      const joined = await api.joinSng(playerId, buyIn, {
        devAck: datToken?.devBuyInEnabled,
      });
      setTableId(joined.tableId);
      setTableFormat("sng");
      setTableMaxSeats(joined.maxSeats ?? 9);
      setSng(joined.sng ?? null);
      setTableFocusMode(true);
      setTableSeats(joined.seats);
      setHand(joined.hand);
      setHandInProgress(joined.handInProgress);
      await refreshAccount(playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const takeHouseSeat = async (openTable: LobbyTable) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!playerId) throw new Error("Create an account or sign in first");
      const buyIn = datToken?.minBuyInMojos ?? "1000000";
      setStatus("Taking a house seat…");
      const claimed = await api.claimHouse(openTable.tableId, playerId, buyIn, {
        devAck: datToken?.devBuyInEnabled,
      });
      setTableId(openTable.tableId);
      setTableFormat(claimed.format === "mtt" ? "mtt" : "sng");
      setSng(claimed.sng ?? null);
      setTableFocusMode(true);
      setTableSeats(claimed.seats);
      setHand(claimed.hand);
      setHandInProgress(claimed.handInProgress);
      await refreshAccount(playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const minBuyInMojos = datToken?.minBuyInMojos ?? "1000000";

  const rebuyAtTable = () => {
    if (!tableId || !playerId) return;
    run("Buying in…", async () => {
      const account = BigInt(accountMojos ?? "0");
      if (account < BigInt(minBuyInMojos) && !datToken?.devBuyInEnabled) {
        throw new Error(
          `Redeem ${formatDatMojos(datToken?.dailyRedeemMojos ?? "5000000", datToken?.ticker ?? "DAT")} in Lobby, then buy in`,
        );
      }
      const rebought = await api.rebuyTable(tableId, playerId, minBuyInMojos, {
        devAck: datToken?.devBuyInEnabled,
      });
      setHand(rebought.hand);
      setTableSeats(rebought.seats);
      setHandInProgress(rebought.handInProgress);
      setDealerButtonSeat(rebought.dealerButtonSeat ?? null);
      if (rebought.lastHandResult) setHandResult(rebought.lastHandResult);
      else setHandResult(null);
      await refreshAccount(playerId);
      setStatus("Buy-in added — deal when ready.");
    });
  };

  const startHandFlow = () => {
    if (!tableId || !playerId) return;
    if (runoutFromBoardLenRef.current != null) return;
    run("Dealing hand…", async () => {
      setHandResult(null);
      const dealt = await api.goHand(tableId, playerId);
      setHand(dealt.hand);
      if (dealt.lastHandResult) setHandResult(dealt.lastHandResult);
      if (dealt.playthrough) setAccountPlaythrough(dealt.playthrough);
      await refreshTable(tableId);
    });
  };
  const startHandFlowRef = useRef(startHandFlow);
  startHandFlowRef.current = startHandFlow;

  const sendAction = (action: PlayerAction, amountMojos?: string) => {
    if (!tableId || !playerId) return;
    const me = hand?.players.find((p) => p.playerId === playerId);
    const callIsAllIn = action === "call" && isCallAllIn(me, hand?.currentBetMojos);
    if ((action === "all-in" || callIsAllIn) && hand) {
      const nextPlayers = hand.players.map((p) =>
        p.playerId === playerId ? { ...p, allIn: true, stackMojos: "0" } : p,
      );
      const bettingClosed = allInBettingClosed(nextPlayers);
      liveHandMeta.current = {
        handId: hand.handId,
        boardLen: bettingClosed
          ? hand.board.length
          : liveHandMeta.current.handId === hand.handId
            ? liveHandMeta.current.boardLen
            : hand.board.length,
        allIn: true,
        allInPlayerIds: [...new Set([...liveHandMeta.current.allInPlayerIds, playerId])],
        viewerFolded: false,
        bettingClosed,
      };
    }
    if (action === "fold") {
      liveHandMeta.current = {
        ...liveHandMeta.current,
        allIn: false,
        viewerFolded: true,
      };
    }
    run(action, async () => {
      const response = await api.action(tableId, playerId, action, amountMojos);
      applyActionResponse(response);
      if (!response.hand) await refreshTable(tableId);
    });
  };

  const myTableSeat = tableSeats.find((s) => s.playerId === playerId);
  const tableStackMojos = myTableSeat?.stackMojos ?? null;
  const tableStackIsZero =
    tableStackMojos != null && (() => {
      try {
        return BigInt(tableStackMojos) === 0n;
      } catch {
        return false;
      }
    })();
  const canRebuyAtTable = Boolean(
    tableId &&
      tableFormat !== "sng" &&
      tableFormat !== "mtt" &&
      playerId &&
      !hand &&
      !handInProgress &&
      datToken?.buyInReady &&
      tableStackIsZero,
  );
  const mySngPlace = sng?.placements.find((row) => row.playerId === playerId);
  const sngEliminated = Boolean(
    (tableFormat === "sng" || tableFormat === "mtt") &&
      playerId &&
      !myTableSeat &&
      (sng?.status === "finished" || mySngPlace) &&
      !sng?.relocatedToTableId,
  );
  const sngCanAutoDeal = sngShouldAutoDeal({
    atTableRoom,
    tableFormat,
    sngStatus: sng?.status,
    seated: Boolean(myTableSeat),
    handLive: Boolean(hand || handInProgress),
    busy,
    stackIsZero: tableStackIsZero,
    runoutPlaying: runoutFromBoardLen != null,
    eliminated: sngEliminated,
    pauseDeals: Boolean(sng?.pauseDeals),
  });

  useEffect(() => {
    if (!sngCanAutoDeal) return;
    const delay = handResult ? 1600 : 400;
    const id = window.setTimeout(() => {
      startHandFlowRef.current();
    }, delay);
    return () => window.clearTimeout(id);
  }, [sngCanAutoDeal, handResult]);
  const handsPlayed = Math.max(myTableSeat?.handsPlayed ?? 0, accountPlaythrough?.handsPlayed ?? 0);
  const handsRequired = Math.max(myTableSeat?.handsRequired ?? 0, accountPlaythrough?.handsRequired ?? 0);
  const playthroughRemaining = handsRequired > 0 ? Math.max(0, handsRequired - handsPlayed) : 0;
  const unlockedMojos = (() => {
    try {
      const seat = BigInt(myTableSeat?.unlockedMojos ?? "0");
      const account = BigInt(accountPlaythrough?.unlockedMojos ?? "0");
      return (seat > account ? seat : account).toString();
    } catch {
      return myTableSeat?.unlockedMojos ?? accountPlaythrough?.unlockedMojos ?? "0";
    }
  })();
  const unlockedDat = (() => {
    try {
      return BigInt(unlockedMojos);
    } catch {
      return 0n;
    }
  })();
  const accountUnlockedMojos = (() => {
    try {
      const reported = accountPlaythrough?.withdrawableMojos;
      if (reported != null && reported !== "") {
        const n = BigInt(reported);
        return (n / CAT_MOJOS_PER_TOKEN) * CAT_MOJOS_PER_TOKEN;
      }
      const held = BigInt(accountMojos ?? "0");
      const capped = unlockedDat < held ? unlockedDat : held;
      return (capped / CAT_MOJOS_PER_TOKEN) * CAT_MOJOS_PER_TOKEN;
    } catch {
      return 0n;
    }
  })();

  const leaveTableView = () => {
    setTableId(null);
    setTableSeats([]);
    setSng(null);
    setHand(null);
    setHandResult(null);
    setTableFormat("cash");
    setTableMaxSeats(6);
    setTableFocusMode(true);
    if (playerId) void refreshAccount(playerId);
  };

  const cashOutToAccount = () => {
    if (!tableId || !playerId) return;
    run("Cashing out…", async () => {
      await refreshTable(tableId);
      const seat = (await api.getTable(tableId, playerId)).seats.find((s) => s.playerId === playerId);
      if (!seat) {
        throw new Error("You are no longer seated at this table");
      }
      const result = await api.withdraw(tableId, playerId, {
        toAccount: true,
      });
      setWithdrawResult(result);
      if (result.playthrough) setAccountPlaythrough(result.playthrough);
      if (result.stillSeated) {
        await refreshTable(tableId);
      } else {
        setTableId(null);
        setTableSeats([]);
        setHand(null);
        setHandResult(null);
      }
      await refreshAccount(playerId);
    });
  };

  const withdrawToSage = () => {
    if (!tableId || !playerId || !walletAddress) return;
    run("Withdrawing to Sage…", async () => {
      await refreshTable(tableId);
      const seat = (await api.getTable(tableId, playerId)).seats.find((s) => s.playerId === playerId);
      if (!seat) {
        throw new Error("You are no longer seated at this table");
      }
      const stackMojos = seat.unlockedMojos && BigInt(seat.unlockedMojos) > 0n
        ? seat.unlockedMojos
        : seat.stackMojos;

      let withdrawProof: BuyInProof | undefined;
      if (!datToken?.devBuyInEnabled && session && wcConfig) {
        const { message } = await api.withdrawMessage({
          tableId,
          address: walletAddress,
          stackMojos,
        });
        setStatus("Approve withdraw in Sage (check your phone)…");
        const signed = await signWithdrawMessage(
          session,
          wcConfig.projectId,
          wcConfig.chainId,
          message,
          walletAddress,
        );
        withdrawProof = {
          address: walletAddress,
          message,
          signature: signed.signature,
          pubkey: signed.pubkey,
        };
      }

      setStatus(
        withdrawConfig?.treasuryReachable
          ? "Asking treasury for a DAT offer…"
          : "Cashing out table stack…",
      );
      const result = await api.withdraw(tableId, playerId, {
        withdrawProof,
        devAck: datToken?.devBuyInEnabled,
        address: walletAddress,
      });

      if (result.mode === "offer" && result.offer) {
        setStatus("Treasury offer is ready. Import it in your player Sage wallet — not the treasury key.");
      }

      setWithdrawResult(result);
      if (result.playthrough) setAccountPlaythrough(result.playthrough);
      if (result.stillSeated) {
        await refreshTable(tableId);
      } else {
        setTableId(null);
        setTableSeats([]);
        setHand(null);
        setHandResult(null);
      }

      if (session && wcConfig && datToken?.assetId) {
        const { balance } = await loadPlayerWallet(
          session,
          wcConfig.projectId,
          wcConfig.chainId,
          datToken.assetId,
        );
        setDatBalance(balance.spendable);
      }
      await refreshAccount(playerId);
    });
  };

  const withdrawUnlockedFromAccount = () => {
    if (!playerId) {
      setError("Sign in first, then withdraw.");
      return;
    }
    run("Withdrawing unlocked DAT…", async () => {
      const withdrawable = accountUnlockedMojos;
      if (withdrawable <= 0n) {
        if (unlockedDat > 0n) {
          throw new Error(
            "SNG hands unlocked DAT, but Sage withdraw uses leftover account chips or a 1st–3rd prize",
          );
        }
        throw new Error("Play sit-n-go or cash hands to unlock DAT first");
      }
      let address = walletAddress;
      if (!address && session && wcConfig) {
        setStatus("Reading player Sage address…");
        const loaded = await loadPlayerWallet(
          session,
          wcConfig.projectId,
          wcConfig.chainId,
          datToken?.assetId,
        );
        address = loaded.address;
        setWalletAddress(address);
        setDatBalance(loaded.balance.spendable);
      }
      if (withdrawConfig?.onChainPayoutEnabled && !address) {
        throw new Error(
          "Link a player Sage address first (Connect Sage → Link Sage address). Withdraw needs that address to build the offer.",
        );
      }
      const stackMojos = withdrawable.toString();
      let withdrawProof: BuyInProof | undefined;
      if (!datToken?.devBuyInEnabled && session && wcConfig && address) {
        const { message } = await api.withdrawMessage({
          tableId: tableId ?? undefined,
          address,
          stackMojos,
          fromAccount: true,
        });
        setStatus("Approve withdraw in Sage (check your phone)…");
        const signed = await signWithdrawMessage(
          session,
          wcConfig.projectId,
          wcConfig.chainId,
          message,
          address,
        );
        withdrawProof = {
          address,
          message,
          signature: signed.signature,
          pubkey: signed.pubkey,
        };
      }
      setStatus(
        withdrawConfig?.treasuryReachable
          ? "Asking treasury for a DAT offer…"
          : "Releasing unlocked DAT in your table account…",
      );
      const result = await api.withdraw(tableId, playerId, {
        withdrawProof,
        devAck: datToken?.devBuyInEnabled,
        fromAccount: true,
        address: address ?? undefined,
      });
      if (result.mode === "offer" && result.offer) {
        setStatus("Treasury offer is ready. Import it in your player Sage — Offers → Import.");
      } else {
        setStatus(result.note);
      }
      setWithdrawResult(result);
      if (result.playthrough) setAccountPlaythrough(result.playthrough);
      await refreshAccount(playerId);
    });
  };

  const appStage = import.meta.env.VITE_APP_STAGE;
  const isBeta = appStage === "beta";
  const pageIsHttp = typeof window !== "undefined" && window.location.protocol === "http:";

  const me = hand?.players.find((p) => p.playerId === playerId);
  const currentBet = BigInt(hand?.currentBetMojos ?? 0);
  const myBet = BigInt(me?.betThisStreetMojos ?? 0);
  const toCall = currentBet - myBet;
  const canCheck = toCall <= 0n;
  const myStack = BigInt(me?.stackMojos ?? 0);

  const lastRaiseIncrement = useMemo(() => {
    if (!hand?.lastRaiseIncrementMojos) return bigBlindMojos;
    try {
      const inc = BigInt(hand.lastRaiseIncrementMojos);
      return inc > 0n ? inc : bigBlindMojos;
    } catch {
      return bigBlindMojos;
    }
  }, [hand?.lastRaiseIncrementMojos, bigBlindMojos]);

  const betRange = useMemo(
    () =>
      computeNlheBetRange({
        bigBlindMojos,
        currentBetMojos: currentBet,
        myBetThisStreetMojos: myBet,
        myStackMojos: myStack,
        lastRaiseIncrementMojos: lastRaiseIncrement,
      }),
    [bigBlindMojos, currentBet, myBet, myStack, lastRaiseIncrement],
  );

  const actionSeatPlayer =
    hand?.actionSeat != null
      ? hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded)
      : null;

  const isMyAction =
    actionSeatPlayer?.playerId === playerId &&
    Boolean(me && !me.folded && !me.allIn && BigInt(me.stackMojos) > 0n);
  const liveHandLabel =
    me && me.holeCards.length > 0 ? describeLiveHand(me.holeCards, hand?.board ?? []) : null;
  const actionSecondsLeft = actionSecondsRemaining(turnElapsedMs);
  const showSlothReminder =
    slothPreview || (isMyAction && shouldShowSloth(turnElapsedMs, true));

  handForTimerRef.current = hand;
  playerIdForTimerRef.current = playerId;
  sendActionRef.current = sendAction;

  useEffect(() => {
    if (!isMyAction || !hand) {
      setTurnElapsedMs(0);
      turnTimeoutFiredRef.current = null;
      return;
    }
    const key = turnTimerKey(hand);
    turnTimeoutFiredRef.current = null;
    const started = Date.now();
    setTurnElapsedMs(0);
    const tick = window.setInterval(() => {
      setTurnElapsedMs(Date.now() - started);
    }, 200);
    const actionTimer = window.setTimeout(() => {
      if (turnTimeoutFiredRef.current === key) return;
      turnTimeoutFiredRef.current = key;
      const h = handForTimerRef.current;
      const pid = playerIdForTimerRef.current;
      if (!h || !pid) return;
      sendActionRef.current(autoActionOnTimeout(h, pid));
    }, PLAYER_ACTION_LIMIT_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(actionTimer);
    };
  }, [isMyAction, hand?.handId, hand?.actionSeat, hand?.street, hand?.currentBetMojos]);

  useEffect(() => {
    const base = isBeta ? "DAT Poker beta" : "DAT Poker";
    if (!isMyAction || !shouldShowSloth(turnElapsedMs, true)) {
      document.title = base;
      return;
    }
    document.title = `Your turn! · ${base}`;
    let showCue = true;
    const t = window.setInterval(() => {
      showCue = !showCue;
      document.title = showCue ? `Your turn! · ${base}` : base;
    }, 900);
    return () => {
      window.clearInterval(t);
      document.title = base;
    };
  }, [isBeta, isMyAction, turnElapsedMs]);

  useEffect(() => {
    if (!isMyAction || !betRange.canBetOrRaise) return;
    setBetAmountMojos(betRange.minRaiseTo);
  }, [
    hand?.handId,
    hand?.street,
    hand?.actionSeat,
    hand?.currentBetMojos,
    me?.stackMojos,
    me?.betThisStreetMojos,
    isMyAction,
    betRange.minRaiseTo,
    betRange.canBetOrRaise,
  ]);

  useEffect(() => {
    if (window.location.hash === "#lucky") {
      setBigWin("irish");
    }
    if (window.location.hash === "#hunter") {
      setBigWin("hunter");
    }
    if (window.location.hash === "#cards") {
      setCardPreview(true);
    }
    if (window.location.hash === "#sloth") {
      setSlothPreview(true);
    }
  }, []);

  useEffect(() => {
    if (!handResult || !playerId) return;
    if (!shouldCelebrateBigWin({ playerId, result: handResult, bigBlindMojos })) return;
    if (celebratedHandId.current === handResult.handId) return;
    celebratedHandId.current = handResult.handId;
    const overlay = pickBigWinOverlay(lastBigWin.current);
    lastBigWin.current = overlay;
    setBigWin(overlay);
  }, [handResult, playerId, bigBlindMojos]);

  useEffect(() => {
    if (!atTableRoom) return;
    document.documentElement.classList.add("play-table-screen");
    return () => document.documentElement.classList.remove("play-table-screen");
  }, [atTableRoom]);

  useEffect(() => {
    if (!handHistoryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHandHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handHistoryOpen]);

  return (
    <div className={`app ${atTableRoom ? "app--table-room" : "app--lobby"}`}>
      {bigWin === "irish" && <LuckyIrishWin onFinished={() => setBigWin(null)} />}
      {bigWin === "hunter" && <HunterBullseyeWin onFinished={() => setBigWin(null)} />}
      {showSlothReminder && (
        <YourTurnSloth secondsLeft={slothPreview ? undefined : actionSecondsLeft} />
      )}
      {isBeta && !atTableRoom && (
        <div className="beta-banner" role="status">
          Public beta — software under development.           Open tables reset on restart;
          your account DAT and play-through progress are kept. Dev buy-in is for testing, not real-money settlement.
        </div>
      )}
      {playerId && tableId && (
        <HandHistoryModal
          open={handHistoryOpen}
          onClose={() => setHandHistoryOpen(false)}
          datToken={datToken}
          playerId={playerId}
          hands={handHistory}
          playerLabel={playerLabel}
          seatDisplayFor={(id) => tableSeats.find((s) => s.playerId === id)?.displayAddress}
        />
      )}
      {atTableRoom ? (
        <>
          {error && <div className="banner error table-room-banner">{error}</div>}
          {status && <div className="banner info table-room-banner">{status}</div>}
          <TableRoom
            datToken={datToken}
            playerId={playerId!}
            tableSeats={tableSeats}
            dealerButtonSeat={dealerButtonSeat}
            tableStackMojos={tableStackMojos}
            hand={hand}
            handResult={handResult}
            handInProgress={handInProgress}
            smallBlindMojos={smallBlindMojos}
            bigBlindMojos={bigBlindMojos}
            busy={busy}
            liveHandLabel={liveHandLabel}
            isMyAction={isMyAction}
            actionSecondsLeft={actionSecondsLeft}
            canCheck={canCheck}
            toCall={toCall}
            betRange={betRange}
            betAmountMojos={betAmountMojos}
            myStack={myStack}
            onBetAmountChange={setBetAmountMojos}
            onSendAction={sendAction}
            onStartHand={startHandFlow}
            canRebuy={canRebuyAtTable}
            canDeal={Boolean(myTableSeat) && sng?.status !== "finished"}
            onRebuy={rebuyAtTable}
            rebuyLabel={formatDatMojos(minBuyInMojos, datToken?.ticker)}
            onOpenLobby={() => setTableFocusMode(false)}
            handHistoryCount={handHistory.length}
            onOpenHandHistory={() => setHandHistoryOpen(true)}
            playerLabel={playerLabel}
            seatPositionLabel={seatPositionLabel}
            maxSeats={tableMaxSeats}
            tableTitle={
              sng?.isFinalTable
                ? "Final Table"
                : sng?.kind === "mtt"
                  ? (sng.tableLabel ?? "16-max SNG")
                  : tableFormat === "sng"
                    ? "9-max SNG"
                    : "6-max"
            }
            sng={tableFormat === "sng" || tableFormat === "mtt" ? sng : null}
            runoutFromBoardLen={runoutFromBoardLen}
            onRunoutFinished={() => {
              holdTableForRunoutRef.current = false;
              setRunoutFromBoardLen(null);
            }}
            playthroughHandsPlayed={handsPlayed}
            playthroughHandsRequired={handsRequired}
            playthroughUnlockedMojos={unlockedMojos}
            playthroughWithdrawableMojos={accountUnlockedMojos.toString()}
          />
        </>
      ) : (
        <>
      <header>
        {onNavigate && <SiteNav page="play" onNavigate={onNavigate} />}
        <h1>DAT Poker{isBeta ? " beta" : ""}</h1>
        <p className="tagline">Account · daily 5000 DAT · play-through accumulates · Sage only to withdraw</p>
        {lobbyPresence != null && apiOk && (
          <p className="lobby-presence" role="status">
            {lobbyPresence.seatedHumans === 0
              ? "No human players seated at tables right now."
              : lobbyPresence.seatedHumans === 1
                ? "1 player seated at tables"
                : `${lobbyPresence.seatedHumans} players seated at tables`}
            {lobbyPresence.humansInHand > 0 && (
              <>
                {" "}
                · {lobbyPresence.humansInHand} in a hand
              </>
            )}
          </p>
        )}
        <p className={`api-status ${apiOk ? "ok" : apiOk === false ? "err" : ""}`}>
          API: {apiOk === null ? "checking…" : apiOk ? "connected" : "offline (run pnpm dev:api)"}
        </p>
      </header>

      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner info">{status}</div>}

      {tableId && (
        <section className="panel seated-return">
          <h2>At the table</h2>
          <p className="muted small">
            {hand || handInProgress
              ? "A hand is in progress — return to the table to act."
              : "You are seated. Cash out here or return to deal the next hand."}
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => setTableFocusMode(true)}>
              Return to table
            </button>
          </div>
        </section>
      )}

      {cardPreview && (
        <section className="panel">
          <h2>Card size preview</h2>
          <CardRow label="Board" cards={CARD_PREVIEW_BOARD} size="lg" />
          <CardRow label="Your hole cards" cards={CARD_PREVIEW_HOLE} size="lg" />
          {CARD_PREVIEW_HAND && (
            <p className="live-hand">
              Your hand: <strong>{CARD_PREVIEW_HAND}</strong>
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Account</h2>
        {!playerId ? (
          <>
            <p className="muted small">
              Create an account to redeem funded DAT and sit at a table. You do not need
              Sage until you want DAT in your wallet.
            </p>
            <AuthPanel
              busy={busy || apiOk === false}
              apiError={error}
              verificationPending={verificationPending}
              onAuth={handleAuth}
              onVerifyEmail={handleVerifyEmail}
              onResendVerification={handleResendVerification}
              onAddEmail={handleAddEmail}
              onForgot={handleForgot}
              onReset={handleReset}
            />
          </>
        ) : (
          <>
            <p className="ok-text">Signed in as {username ?? "player"}</p>
            {accountMojos != null && (
              <p>
                Table account:{" "}
                <strong>{formatDatMojos(accountMojos, datToken?.ticker)}</strong>
                {redeemedToday ? " · redeem available in 24h" : ""}
              </p>
            )}
            {handsRequired > 0 && (
              <p className="muted small">
                Play-through: {handsPlayed}/{handsRequired}{" "}
                hands · {formatDatMojos(unlockedMojos, datToken?.ticker)} unlocked
                (1 redeemed DAT = 1 hand)
                {accountUnlockedMojos > 0n
                  ? ` · ${formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)} unlocked in your table account`
                  : unlockedDat > 0n
                    ? " · leftover account chips or a 1st–3rd SNG prize are required"
                    : " · stays until you release it from play-through"}
              </p>
            )}
            <div className="row">
              <button
                type="button"
                disabled={busy || !playerId || redeemedToday}
                onClick={redeemDaily}
              >
                Redeem {formatDatMojos(datToken?.dailyRedeemMojos ?? "5000000", datToken?.ticker)} today
              </button>
              <button type="button" disabled={busy} className="secondary" onClick={signOut}>
                Sign out
              </button>
            </div>
            <ChangePasswordForm busy={busy} onChangePassword={handleChangePassword} />
          </>
        )}
      </section>

      {playerId && (
      <section className="panel">
        <h2>Withdraw DAT (Sage)</h2>
        {pageIsHttp && (
          <p className="muted">
            Sage WalletConnect needs HTTPS. Open the <code>https://</code> site
            (for example <code>https://datspiritpoker.com</code>), not <code>http://</code>
            plus the Elastic IP.
          </p>
        )}
        <p className="muted small">
          Pairing only signs a message. This site cannot send DAT or XCH from Sage.
          When treasury is active, withdraw builds an offer you import in a{" "}
          <strong>player</strong> Sage wallet. Do not use the treasury Sage key.
        </p>
        {withdrawConfig && (
          <div className={withdrawConfig.treasuryReachable ? "ok-text" : "muted small"}>
            <p>
              Treasury:{" "}
              {withdrawConfig.treasuryReachable
                ? withdrawConfig.treasuryWalletRpcReachable === false
                  ? `HTTP is up at ${withdrawConfig.treasuryHost ?? "payout service"}, but Sage RPC is not logged in. Enable RPC :9257 on the AWS host, then try again.`
                  : `active at ${withdrawConfig.treasuryHost ?? "payout service"} — withdraw can send a DAT offer to your player Sage`
                : withdrawConfig.treasuryConfigured
                  ? `configured but not reachable at ${withdrawConfig.treasuryHost ?? "the payout URL"}${
                      withdrawConfig.treasuryError ? ` (${withdrawConfig.treasuryError})` : ""
                    }. Redeploy so dat-poker-treasury stays up with the website, then check again.`
                  : "not configured. Set DAT_TREASURY_PAYOUT_URL and start treasury."}
            </p>
            {withdrawConfig.treasuryConfigured && !withdrawConfig.treasuryReachable && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run("Checking treasury…", async () => {
                    await refreshTreasuryStatus();
                  })
                }
              >
                Check treasury again
              </button>
            )}
          </div>
        )}
        {playerId && handsRequired > 0 && (
          <p>
            Unlocked in table account:{" "}
            <strong>{formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)}</strong>
            {unlockedDat > 0n && accountUnlockedMojos === 0n
              ? " — leftover account chips or a 1st–3rd prize are required"
              : withdrawConfig?.treasuryReachable
                ? " — ready for a player Sage offer"
                : " — leftover stays here until treasury is active"}
          </p>
        )}
        {!wcConfig ? (
          <p className="muted">Set WALLETCONNECT_PROJECT_ID in API .env to enable Sage withdraw.</p>
        ) : !session ? (
          <button type="button" disabled={busy || !apiOk} onClick={connectSage}>
            Connect Sage to withdraw DAT
          </button>
        ) : (
          <>
            <p className="ok-text">Sage paired</p>
            <div className="row">
              <button type="button" disabled={busy} className="secondary" onClick={linkSageWallet}>
                Link Sage address
              </button>
              <button type="button" disabled={busy} className="secondary" onClick={disconnectSage}>
                Disconnect Sage
              </button>
            </div>
            {walletAddress && (
              <p className="mono">
                Address: {shortAddress(walletAddress)}
                {datBalance != null && (
                  <>
                    {" "}
                    · Sage {datToken?.ticker ?? "DAT"}: {formatDatMojos(datBalance, datToken?.ticker)}
                  </>
                )}
              </p>
            )}
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            {status && /withdraw|treasury|offer|Sage address/i.test(status) && (
              <p className="banner info" role="status">
                {status}
              </p>
            )}
            {accountUnlockedMojos > 0n && (
              <div className="row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={withdrawUnlockedFromAccount}
                >
                  {busy
                    ? "Withdrawing…"
                    : withdrawConfig?.treasuryReachable
                      ? `Withdraw ${formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)} to player Sage`
                      : `Release ${formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)} unlocked in table account`}
                </button>
              </div>
            )}
            {withdrawConfig?.treasuryReachable && !walletAddress && (
              <p className="muted small">Link a player Sage address first (not the treasury key), then click Withdraw. A click without that address now shows an error instead of hanging.</p>
            )}
            {withdrawResult && (
              <div className="banner win">
                {withdrawResult.mode === "offer" && withdrawResult.offer
                  ? "Offer ready — import it in player Sage."
                  : withdrawResult.note}
                {withdrawResult.offer && (
                  <div className="sage-offer-box">
                    <p>
                      In <strong>player Sage</strong> (not treasury): Offers → Import. Paste this offer and
                      accept it.
                    </p>
                    <textarea readOnly rows={4} value={withdrawResult.offer} />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText(withdrawResult.offer ?? "");
                        setStatus("Offer copied. Import it in player Sage.");
                      }}
                    >
                      Copy offer
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
      )}

      <section className="panel">
        <h2>{tableId ? "Leave table" : "Table"}</h2>
        {!tableId ? (
          <>
            <button
              type="button"
              disabled={busy || !apiOk || !playerId || !datToken?.buyInReady}
              onClick={() => void joinTable()}
            >
              Buy in &amp; join 6-max ({formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)})
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !apiOk || !playerId || !datToken?.buyInReady}
              onClick={() => void joinSng()}
            >
              Buy in {formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)} &amp; start
              9-max SNG
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !apiOk || !playerId || !datToken?.buyInReady}
              onClick={() => void joinMtt()}
            >
              Buy in {formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)} &amp; start
              16-player SNG
            </button>
            <p className="muted small">
              Sit-n-go buy-in is {formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)}.
              Prize pool is each human buy-in. Finish 1st, 2nd, or 3rd overall to get paid
              50% / 30% / 20%. House seats in the money are not paid. Each completed SNG
              hand unlocks 1 DAT in your table account from leftover chips or prizes.
              On-chain Sage payout is off, so unlocked DAT will not appear in Sage.
            </p>
            <div className="lobby">
              <h3>Active sit-n-gos</h3>
              <p className="muted small">
                Take a house seat on a live SNG, or start a new one if a table is full.
              </p>
              {lobbyTables.filter((row) => (row.format === "sng" || row.format === "mtt") && row.sng?.status !== "finished").length === 0 ? (
                <p className="muted">No active sit-n-gos yet.</p>
              ) : (
                <ul className="lobby-list">
                  {lobbyTables
                    .filter((row) => (row.format === "sng" || row.format === "mtt") && row.sng?.status !== "finished")
                    .map((row) => {
                      const humans = row.humanCount ?? row.humans ?? 0;
                      const house = row.houseSeatsAvailable ?? 0;
                      const full = Boolean(row.full) || house === 0;
                      return (
                        <li key={row.tableId}>
                          <span>
                            {row.sng?.isFinalTable
                              ? "Final Table"
                              : row.sng?.kind === "mtt"
                                ? (row.sng.tableLabel ?? "16-max")
                                : "9-max"}
                            {" · "}
                            {humans} human{humans === 1 ? "" : "s"}
                            {row.humanPlayerIds?.length
                              ? ` (${row.humanPlayerIds.map((id) => playerLabel(id, playerId)).join(", ")})`
                              : ""}
                            {" · "}
                            {full ? "full" : `${house} house`}
                            {row.sng?.buyInMojos
                              ? ` · buy-in ${formatDatMojos(row.sng.buyInMojos, datToken?.ticker)}`
                              : ""}
                            {row.sng?.prizePoolMojos
                              ? ` · pool ${formatDatMojos(row.sng.prizePoolMojos, datToken?.ticker)}`
                              : ""}
                            {row.sng?.smallBlindMojos && row.sng?.bigBlindMojos
                              ? ` · blinds ${formatDatAmount(row.sng.smallBlindMojos)}/${formatDatAmount(row.sng.bigBlindMojos)}`
                              : ""}
                            {row.handInProgress ? " · hand in progress" : ""} · {row.sng?.status ?? "running"}
                          </span>
                          {full ? (
                            <button
                              type="button"
                              disabled={busy || !playerId || !datToken?.buyInReady}
                              onClick={() => void joinSng()}
                            >
                              Start new SNG
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy || !playerId || !datToken?.buyInReady || row.handInProgress}
                              onClick={() => void takeHouseSeat(row)}
                            >
                              {row.handInProgress ? "Wait for hand" : "Take house seat"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mono">Table ID: {tableId}</p>
            {sng && (
              <p>
                SNG {sng.status} · buy-in {formatDatMojos(sng.buyInMojos, datToken?.ticker)} · pool{" "}
                {formatDatMojos(sng.prizePoolMojos, datToken?.ticker)} · pays 1st–3rd 50/30/20
                {sng.payouts?.length
                  ? ` (${sng.payouts
                      .map((row) => `${row.place}: ${formatDatMojos(row.prizeMojos, datToken?.ticker)}`)
                      .join(" · ")})`
                  : ""}
                {" · "}
                blinds {formatDatAmount(sng.smallBlindMojos)}/{formatDatAmount(sng.bigBlindMojos)}
                {sng.nextSmallBlindMojos && sng.nextBigBlindMojos
                  ? ` · next ${formatDatAmount(sng.nextSmallBlindMojos)}/${formatDatAmount(sng.nextBigBlindMojos)}`
                  : ""}
                {" · "}
                {sng.kind === "mtt"
                  ? `${sng.eventPlayersRemaining ?? sng.playersRemaining} left in the field`
                  : `${sng.playersRemaining}/${sng.maxSeats} left`}
                {sng.kind === "mtt" && !sng.isFinalTable && sng.otherTablePlayers != null
                  ? ` · ${sng.otherTablePlayers} at the other table`
                  : ""}
                {" · "}
                {sng.humanCount} human
                {sng.humanCount === 1 ? "" : "s"} · {sng.houseSeatsAvailable} house
              </p>
            )}
            {sngEliminated && (
              <div className="banner info">
                You are out
                {mySngPlace ? ` — place ${mySngPlace.place}` : ""}
                {mySngPlace && BigInt(mySngPlace.prizeMojos) > 0n
                  ? ` · ${formatDatMojos(mySngPlace.prizeMojos, datToken?.ticker)} paid to your account`
                  : ". You have to finish 1st–3rd overall to get paid."}
                {unlockedDat > 0n
                  ? ` · ${formatDatMojos(unlockedMojos, datToken?.ticker)} unlocked by SNG hands`
                  : ""}
                {accountUnlockedMojos > 0n
                  ? ` · ${formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)} unlocked in your table account`
                  : unlockedDat > 0n && accountUnlockedMojos === 0n
                    ? " · leftover account chips or a prize are needed"
                    : ""}
              </div>
            )}
            {sng?.placements.length ? (
              <ol className="placements">
                {sng.placements
                  .filter((row) => !isHousePlayerId(row.playerId))
                  .map((row) => (
                    <li key={row.playerId}>
                      {row.place}. {playerLabel(row.playerId, playerId)}
                      {BigInt(row.prizeMojos) > 0n
                        ? ` — ${formatDatMojos(row.prizeMojos, datToken?.ticker)}`
                        : " — out"}
                    </li>
                  ))}
              </ol>
            ) : null}
            {(sngEliminated || sng?.status === "finished") && (
              <div className="row">
                <button type="button" disabled={busy} onClick={leaveTableView}>
                  Back to lobby
                </button>
              </div>
            )}
            <ol className="seat-list">
              {Array.from({ length: tableMaxSeats }, (_, i) => {
                const seated = tableSeats.find((s) => s.seatIndex === i);
                const isDealer = (hand?.dealerSeat ?? dealerButtonSeat) === i;
                return (
                  <li key={i} className={isDealer ? "seat-list-dealer" : undefined}>
                    Seat {i + 1}
                    {isDealer ? " (D)" : ""}:{" "}
                    {seated
                      ? `${playerLabel(seated.playerId, playerId, seated.displayAddress)} · ${formatDatMojos(seated.stackMojos, datToken?.ticker)}${seatPositionLabel(i, hand, dealerButtonSeat)}`
                      : "empty"}
                  </li>
                );
              })}
            </ol>
            {tableId && playerId && (
              <p className="hand-history-lobby-link">
                <button
                  type="button"
                  className="table-room-history-link"
                  disabled={busy}
                  onClick={() => setHandHistoryOpen(true)}
                >
                  Open hand history{handHistory.length > 0 ? ` (${handHistory.length})` : ""}
                </button>
              </p>
            )}
            {tableStackMojos && (
              <p>
                Your table stack:{" "}
                <strong>{formatDatMojos(tableStackMojos, datToken?.ticker)}</strong>
              </p>
            )}
            {tableId && handsRequired > 0 && (
              <p className="muted small">
                Play-through: {handsPlayed}/{handsRequired} hands ·{" "}
                {formatDatMojos(unlockedMojos, datToken?.ticker)} unlocked (1 hand = 1 DAT)
                {accountUnlockedMojos > 0n
                  ? ` · ${formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)} unlocked in your table account`
                  : " · stays until you release it from play-through"}
                {playthroughRemaining > 0
                  ? ` — ${playthroughRemaining} remaining`
                  : " — fully unlocked"}
              </p>
            )}
            {tableId && !hand && !handInProgress && tableStackMojos && tableFormat !== "sng" && tableFormat !== "mtt" && (
              <div className="row">
                <button type="button" disabled={busy} onClick={cashOutToAccount}>
                  Cash out {formatDatMojos(tableStackMojos, datToken?.ticker)} to account
                </button>
                {walletAddress && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || unlockedDat <= 0n}
                    onClick={withdrawToSage}
                  >
                    Withdraw {formatDatMojos(unlockedMojos, datToken?.ticker)} to Sage
                  </button>
                )}
              </div>
            )}
            {(tableFormat === "sng" || tableFormat === "mtt") && accountUnlockedMojos > 0n && (
              <div className="row">
                <button type="button" disabled={busy} onClick={withdrawUnlockedFromAccount}>
                  {busy
                    ? "Withdrawing…"
                    : withdrawConfig?.treasuryReachable
                      ? `Withdraw ${formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)} to player Sage`
                      : `Release ${formatDatMojos(accountUnlockedMojos.toString(), datToken?.ticker)} unlocked from SNG play`}
                </button>
              </div>
            )}
          </>
        )}
        {withdrawResult && (
          <div className="banner win">
            Withdrew {formatDatMojos(withdrawResult.stackMojos, datToken?.ticker)} from table
            {BigInt(withdrawResult.payoutMojos) > 0n && (
              <>
                {" "}
                · payout {formatDatMojos(withdrawResult.payoutMojos, datToken?.ticker)}
                {withdrawResult.mode === "offer" ? " (treasury offer for player Sage)" : " (table account)"}
              </>
            )}
            . {withdrawResult.note}
            {withdrawResult.offer && (
              <div className="sage-offer-box">
                <p>
                  In <strong>player Sage</strong> (not treasury): Offers → Import. Paste this offer and
                  accept it. DAT should then show in that wallet.
                </p>
                <textarea readOnly rows={4} value={withdrawResult.offer} />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(withdrawResult.offer ?? "");
                    setStatus("Offer copied. Import it in player Sage.");
                  }}
                >
                  Copy offer
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <footer>
        {isBeta ? (
          <p>
            DAT POKER public beta. Redeem 5000 DAT per UTC day into a table account (not an
            on-chain CAT send). 6-max cash, a 9-max sit-n-go, or a 16-player sit-n-go
            (two tables of 8, then a championship final table). Cash still plays the house or another human.
            {" "}
            <a href="/feedback" onClick={(e) => { e.preventDefault(); onNavigate?.("feedback"); }}>
              Send feedback
            </a>
            .
          </p>
        ) : (
          <p>
            Configure API <code>.env</code> with WalletConnect + DAT asset id. Run{" "}
            <code>pnpm dev:api</code>, <code>pnpm dev:treasury</code>, and{" "}
            <code>pnpm dev:web</code>.
          </p>
        )}
      </footer>
        </>
      )}

      {pairingOpen && (
        <QrConnectModal uri={wcUri} status={status} error={pairingError} onClose={cancelPairing} />
      )}
    </div>
  );
}
