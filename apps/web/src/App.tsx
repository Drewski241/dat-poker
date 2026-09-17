import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeNlheBetRange, DAT_TABLE_DEFAULTS, formatDatMojos } from "@dat-poker/shared";
import { api, restoreApiAuthToken, setApiAuthToken, type BuyInProof, type DatTokenInfo, type HandResult, type HandState, type PlayerAction, type PlaythroughInfo, type TableSeat, type WithdrawResult } from "./api.js";
import { AuthPanel, ChangePasswordForm } from "./AuthPanel.js";
import { CardRow } from "./components/PlayingCard.js";
import { LuckyIrishWin } from "./components/LuckyIrishWin.js";
import { HunterBullseyeWin } from "./components/HunterBullseyeWin.js";
import { SuperheroFlyWin } from "./components/SuperheroFlyWin.js";
import { TableRoom } from "./components/TableRoom.js";
import { YourTurnSloth } from "./components/YourTurnSloth.js";
import { describeLiveHand } from "./live-hand.js";
import {
  actionSecondsRemaining,
  autoActionOnTimeout,
  PLAYER_ACTION_LIMIT_MS,
  shouldShowSloth,
  turnTimerKey,
} from "./player-turn-timer.js";
import {
  isLuckyIrishWin,
  pickBigWinOverlay,
  readStoredBigWinOverlay,
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
  if (id === HOUSE_PLAYER_ID) return "House";
  const shown = display && display.length > 0 ? display : id;
  return shown.length > 16 ? `${shown.slice(0, 8)}…${shown.slice(-6)}` : shown;
}

function shortAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export function App({ onNavigate }: { onNavigate?: (next: SitePage) => void } = {}) {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [datToken, setDatToken] = useState<DatTokenInfo | null>(null);
  const [wcConfig, setWcConfig] = useState<{ projectId: string; chainId: string } | null>(null);

  const [session, setSession] = useState<WcSession | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const pairingGen = useRef(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [datBalance, setDatBalance] = useState<string | null>(null);
  const [accountMojos, setAccountMojos] = useState<string | null>(null);
  const [accountPlaythrough, setAccountPlaythrough] = useState<PlaythroughInfo | null>(null);
  const [redeemedToday, setRedeemedToday] = useState(false);

  const [tableId, setTableId] = useState<string | null>(null);
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
  const [smallBlindMojos, setSmallBlindMojos] = useState<bigint>(DAT_TABLE_DEFAULTS.smallBlindMojos);

  useEffect(() => {
    void (async () => {
      try {
        restoreApiAuthToken();
        await api.health();
        setApiOk(true);
        const [config, dat] = await Promise.all([api.walletConfig(), api.datToken()]);
        setDatToken(dat);
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
            }
          } catch {
            /* Stale WalletConnect storage must not mark the API offline — Connect Sage still works. */
          }
        }
      } catch {
        setApiOk(false);
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }, []);

  const refreshAccount = useCallback(async (address: string) => {
    const acc = await api.account(address);
    setAccountMojos(acc.balanceMojos);
    setRedeemedToday(acc.redeemedToday);
    setAccountPlaythrough(acc.playthrough ?? null);
  }, []);

  const refreshTable = useCallback(async (id: string) => {
    const t = await api.getTable(id, playerId ?? undefined);
    setHand(t.hand);
    setTableSeats(t.seats);
    setHandInProgress(t.handInProgress);
    setDealerButtonSeat(t.dealerButtonSeat ?? null);
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
  }, [playerId]);

  const applyActionResponse = useCallback(
    (response: { hand: HandState | null; lastHandResult: HandResult | null }) => {
      setHand(response.hand);
      if (response.lastHandResult) setHandResult(response.lastHandResult);
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

  useEffect(() => {
    if (hand || handInProgress) {
      setTableFocusMode(true);
    }
  }, [hand, handInProgress]);

  useEffect(() => {
    if (!tableId || !playerId || hand || handInProgress) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.setSitOut(tableId, playerId, !tableFocusMode);
        if (cancelled) return;
        setTableSeats(res.seats);
        setHand(res.hand);
        setHandInProgress(res.handInProgress);
        if (res.lastHandResult) setHandResult(res.lastHandResult);
        setDealerButtonSeat(res.dealerButtonSeat ?? null);
      } catch {
        /* ignore while toggling lobby / table */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tableFocusMode, tableId, playerId, hand, handInProgress]);

  const cancelPairing = () => {
    pairingGen.current += 1;
    setPairingOpen(false);
    setWcUri(null);
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
    setPairingOpen(true);
    setStatus("Connecting to WalletConnect…");
    void (async () => {
      try {
        const { uri, approval } = await beginWalletConnect({
          ...wcConfig,
          onUri: (nextUri) => {
            if (pairingGen.current !== gen) return;
            setWcUri(nextUri);
            setStatus("Scan the QR with Sage…");
          },
        });
        if (pairingGen.current !== gen) return;
        setWcUri(uri);
        setStatus("Scan the QR with Sage…");
        const next = await approval();
        if (pairingGen.current !== gen) return;
        setSession(next);
        setPairingOpen(false);
        setWcUri(null);
        setStatus("");
      } catch (e) {
        if (pairingGen.current !== gen) return;
        setError(mapWalletConnectError(e).message);
        setPairingOpen(false);
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
      setTableId(null);
      setTableSeats([]);
      setHand(null);
      setHandResult(null);
      setApiAuthToken(null);
    });

  const handleAuth = (mode: "register" | "login", fields: { username: string; password: string; email?: string }) => {
    void run(mode === "register" ? "Creating account…" : "Signing in…", async () => {
      const result = mode === "register" ? await api.register(fields) : await api.login(fields);
      setApiAuthToken(result.token);
      setPlayerId(result.playerId);
      setUsername(result.username);
      if (result.sageAddress) setWalletAddress(result.sageAddress);
      await refreshAccount(result.playerId);
    });
  };

  const handleForgot = async (fields: { username: string; email: string }) => {
    setBusy(true);
    setError(null);
    setStatus("Requesting reset code…");
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
    });

  const redeemDaily = () =>
    run("Redeeming 5000 DAT…", async () => {
      if (!playerId) throw new Error("Create an account or sign in first");
      const result = await api.redeem(playerId, {
        devAck: datToken?.devBuyInEnabled ?? true,
      });
      setAccountMojos(result.balanceMojos);
      setRedeemedToday(true);
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

  const startHandFlow = () => {
    if (!tableId || !playerId) return;
    run("Dealing hand…", async () => {
      setHandResult(null);
      await refreshTable(tableId);
      const dealt = await api.goHand(tableId, playerId);
      setHand(dealt.hand);
      if (dealt.lastHandResult) setHandResult(dealt.lastHandResult);
      await refreshTable(tableId);
    });
  };

  const seatHouseFlow = () => {
    if (!tableId) return;
    run("Seating house…", async () => {
      const buyIn = datToken?.minBuyInMojos ?? "1000000";
      await api.seatHouse(tableId, buyIn);
      await refreshTable(tableId);
    });
  };

  const sendAction = (action: PlayerAction, amountMojos?: string) => {
    if (!tableId || !playerId) return;
    run(action, async () => {
      const response = await api.action(tableId, playerId, action, amountMojos);
      applyActionResponse(response);
      if (!response.hand) await refreshTable(tableId);
    });
  };

  const myTableSeat = tableSeats.find((s) => s.playerId === playerId);
  const tableStackMojos = myTableSeat?.stackMojos ?? null;
  const handsPlayed = myTableSeat?.handsPlayed ?? accountPlaythrough?.handsPlayed ?? 0;
  const handsRequired = myTableSeat?.handsRequired ?? accountPlaythrough?.handsRequired ?? 0;
  const playthroughRemaining = myTableSeat?.playthroughRemaining ?? accountPlaythrough?.playthroughRemaining ?? 0;
  const unlockedMojos = myTableSeat?.unlockedMojos ?? accountPlaythrough?.unlockedMojos ?? "0";
  const unlockedDat = (() => {
    try {
      return BigInt(unlockedMojos);
    } catch {
      return 0n;
    }
  })();

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

      setStatus("Cashing out table stack…");
      const result = await api.withdraw(tableId, playerId, {
        withdrawProof,
        devAck: datToken?.devBuyInEnabled,
      });

      if (result.mode === "offer" && result.offer) {
        setStatus(
          "On-chain Sage takeOffer is disabled on this host so DAT cannot leave your wallet. Stack is in your table account.",
        );
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
    if (window.location.hash === "#hero") {
      setBigWin("hero");
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
    if (!isLuckyIrishWin({ playerId, result: handResult, bigBlindMojos })) return;
    if (celebratedHandId.current === handResult.handId) return;
    celebratedHandId.current = handResult.handId;
    const overlay = pickBigWinOverlay(lastBigWin.current);
    lastBigWin.current = overlay;
    setBigWin(overlay);
  }, [handResult, playerId, bigBlindMojos]);

  const hasHouse = tableSeats.some((s) => s.playerId === HOUSE_PLAYER_ID);
  const activeHumans = tableSeats.filter(
    (s) => s.playerId !== HOUSE_PLAYER_ID && !s.sittingOut,
  );
  const canSeatHouse = Boolean(
    tableId &&
      !hand &&
      !handInProgress &&
      !hasHouse &&
      activeHumans.length === 1 &&
      activeHumans[0]?.playerId === playerId,
  );

  const atTableRoom = Boolean(tableId && tableFocusMode && playerId);

  useEffect(() => {
    if (!atTableRoom) return;
    document.documentElement.classList.add("play-table-screen");
    return () => document.documentElement.classList.remove("play-table-screen");
  }, [atTableRoom]);

  return (
    <div className={`app ${atTableRoom ? "app--table-room" : "app--lobby"}`}>
      {bigWin === "irish" && <LuckyIrishWin onFinished={() => setBigWin(null)} />}
      {bigWin === "hunter" && <HunterBullseyeWin onFinished={() => setBigWin(null)} />}
      {bigWin === "hero" && <SuperheroFlyWin onFinished={() => setBigWin(null)} />}
      {showSlothReminder && (
        <YourTurnSloth secondsLeft={slothPreview ? undefined : actionSecondsLeft} />
      )}
      {isBeta && !atTableRoom && (
        <div className="beta-banner" role="status">
          Public beta — software under development.           Open tables reset on restart;
          your account DAT and play-through progress are kept. Dev buy-in is for testing, not real-money settlement.
        </div>
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
            onSeatHouse={seatHouseFlow}
            canSeatHouse={canSeatHouse}
            onOpenLobby={() => setTableFocusMode(false)}
            playerLabel={playerLabel}
            seatPositionLabel={seatPositionLabel}
          />
        </>
      ) : (
        <>
      <header>
        {onNavigate && <SiteNav page="play" onNavigate={onNavigate} />}
        <h1>DAT Poker{isBeta ? " beta" : ""}</h1>
        <p className="tagline">Account · daily 5000 DAT · 6-max · Sage only to withdraw</p>
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
              busy={busy || !apiOk}
              onAuth={handleAuth}
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
            {accountPlaythrough && accountPlaythrough.handsRequired > 0 && !tableId && (
              <p className="muted small">
                Play-through: {accountPlaythrough.handsPlayed}/{accountPlaythrough.handsRequired}{" "}
                hands · {formatDatMojos(accountPlaythrough.unlockedMojos, datToken?.ticker)} unlocked
                (saved across redeploys)
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
          Skip this unless you want funded DAT sent to your wallet.
        </p>
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
          </>
        )}
      </section>
      )}

      <section className="panel">
        <h2>{tableId ? "Leave table" : "Table"}</h2>
        {!tableId ? (
          <button
            type="button"
            disabled={busy || !apiOk || !playerId || !datToken?.buyInReady}
            onClick={() => void joinTable()}
          >
            Buy in &amp; join 6-max ({formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)})
          </button>
        ) : (
          <>
            <p className="mono">Table ID: {tableId}</p>
            <ol className="seat-list">
              {Array.from({ length: 6 }, (_, i) => {
                const seated = tableSeats.find((s) => s.seatIndex === i);
                return (
                  <li key={i}>
                    Seat {i + 1}:{" "}
                    {seated
                      ? `${playerLabel(seated.playerId, playerId, seated.displayAddress)} · ${formatDatMojos(seated.stackMojos, datToken?.ticker)}${seated.sittingOut && seated.playerId !== HOUSE_PLAYER_ID ? " · sitting out" : ""}${seatPositionLabel(i, hand, dealerButtonSeat)}`
                      : "empty"}
                  </li>
                );
              })}
            </ol>
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
                {playthroughRemaining > 0
                  ? ` — ${playthroughRemaining} remaining`
                  : " — fully unlocked"}
              </p>
            )}
            {tableId && !hand && !handInProgress && myTableSeat?.sittingOut && (
              <p className="muted small">You are sitting out — return to the table to play hands.</p>
            )}
            {tableId && !hand && !handInProgress && canSeatHouse && (
              <button type="button" disabled={busy} onClick={seatHouseFlow}>
                Play vs house (opponent sitting out)
              </button>
            )}
            {tableId && !hand && !handInProgress && tableStackMojos && (
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
          </>
        )}
        {withdrawResult && (
          <div className="banner win">
            Withdrew {formatDatMojos(withdrawResult.stackMojos, datToken?.ticker)} from table
            {BigInt(withdrawResult.payoutMojos) > 0n && (
              <>
                {" "}
                · payout {formatDatMojos(withdrawResult.payoutMojos, datToken?.ticker)}
                {withdrawResult.mode === "offer" ? " (on-chain via offer)" : " (ledger)"}
              </>
            )}
            . {withdrawResult.note}
          </div>
        )}
      </section>

      <footer>
        {isBeta ? (
          <p>
            DAT POKER public beta. Redeem 5000 DAT per UTC day into a table account (not an
            on-chain CAT send). 6-max: play the house or another human on an open seat.
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
        <QrConnectModal uri={wcUri} status={status} onClose={cancelPairing} />
      )}
    </div>
  );
}
