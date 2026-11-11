import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeNlheBetRange, DAT_TABLE_DEFAULTS, formatDatMojos } from "@dat-poker/shared";
import { api, type ActionResponse, type BuyInProof, type CardFace, type DatTokenInfo, type HandResult, type HandState, type HouseAction, type PlayerAction, type TableSeat, type WithdrawResult } from "./api.js";
import { BetSlider } from "./components/BetSlider.js";
import { FeltTable, type FeltSeat } from "./components/FeltTable.js";
import { QrConnectModal } from "./components/QrConnectModal.js";
import {
  beginWalletConnect,
  disconnectWallet,
  findDatCatWallet,
  restoreSession,
  signBuyInMessage,
  signWithdrawMessage,
  takeOffer,
  type WcSession,
} from "./wallet/chia-wallet.js";

const HOUSE_PLAYER_ID = "dat-poker:house";
const DAT_BIG_BLIND_MOJOS = DAT_TABLE_DEFAULTS.bigBlindMojos;
const TURN_SECONDS = 45;

function formatHouseActions(actions: HouseAction[] | undefined, ticker?: string): string | null {
  if (!actions?.length) return null;
  return actions
    .map((action) => {
      const amount = formatDatMojos(action.amountMojos, ticker);
      switch (action.action) {
        case "fold":
          return "House folds";
        case "check":
          return "House checks";
        case "call":
          return "House calls";
        case "bet":
          return `House bets ${amount}`;
        case "raise":
          return `House raises to ${amount}`;
        default:
          return "House is all-in";
      }
    })
    .join(" · ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function playerLabel(id: string, youId: string | null): string {
  if (id === youId) return "You";
  if (id === HOUSE_PLAYER_ID) return "House";
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function shortAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [datToken, setDatToken] = useState<DatTokenInfo | null>(null);
  const [wcConfig, setWcConfig] = useState<{ projectId: string; chainId: string } | null>(null);

  const [session, setSession] = useState<WcSession | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [datBalance, setDatBalance] = useState<string | null>(null);

  const [tableId, setTableId] = useState<string | null>(null);
  const [tableSeats, setTableSeats] = useState<TableSeat[]>([]);
  const [handInProgress, setHandInProgress] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<WithdrawResult | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hand, setHand] = useState<HandState | null>(null);
  const [handResult, setHandResult] = useState<HandResult | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [betAmountMojos, setBetAmountMojos] = useState<bigint>(DAT_BIG_BLIND_MOJOS);
  const [commitHash, setCommitHash] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [snapshot, setSnapshot] = useState<HandState | null>(null);
  const [houseNote, setHouseNote] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const handRef = useRef<HandState | null>(null);
  const playerIdRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await api.health();
        setApiOk(true);
        const [config, dat] = await Promise.all([api.walletConfig(), api.datToken()]);
        setDatToken(dat);
        if (config.walletConnect) {
          setWcConfig(config.walletConnect);
          const existing = await restoreSession(config.walletConnect.projectId);
          if (existing) {
            setSession(existing);
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

  handRef.current = hand;
  playerIdRef.current = playerId;

  const refreshTable = useCallback(async (id: string) => {
    const t = await api.getTable(id, playerIdRef.current);
    setHand(t.hand);
    setTableSeats(t.seats);
    setHandInProgress(t.handInProgress);
    if (t.lastHandResult) setHandResult(t.lastHandResult);
    if (t.hand?.commitHash) setCommitHash(t.hand.commitHash);
  }, []);

  const applyActionResponse = useCallback((response: ActionResponse, ticker?: string) => {
    if (!response.hand && handRef.current) setSnapshot(handRef.current);
    if (response.hand) setSnapshot(null);
    setHand(response.hand);
    if (!response.hand) setHandInProgress(false);
    if (response.lastHandResult) {
      setHandResult(response.lastHandResult);
      setTableSeats(response.lastHandResult.stacks);
      setCommitHash(response.lastHandResult.commitHash);
    }
    const note = formatHouseActions(response.houseActions, ticker);
    if (note) setHouseNote(note);
  }, []);

  const connectSage = () =>
    run("Opening WalletConnect…", async () => {
      if (!wcConfig) throw new Error("WalletConnect not configured on API (.env WALLETCONNECT_PROJECT_ID)");
      const { uri, approval } = await beginWalletConnect(wcConfig);
      setWcUri(uri);
      try {
        const next = await approval();
        setSession(next);
      } finally {
        setWcUri(null);
      }
    });

  const disconnectSage = () =>
    run("Disconnecting…", async () => {
      if (session && wcConfig) {
        await disconnectWallet(session, wcConfig.projectId);
      }
      setSession(null);
      setWalletAddress(null);
      setDatBalance(null);
      setPlayerId(null);
    });

  const loadDatBalance = () =>
    run("Loading DAT balance…", async () => {
      if (!session || !wcConfig || !datToken?.assetId) {
        throw new Error("Connect Sage and configure DAT_GOVERNANCE_TOKEN_ASSET_ID on API");
      }
      const { balance, address } = await findDatCatWallet(
        session,
        wcConfig.projectId,
        wcConfig.chainId,
        datToken.assetId,
      );
      setWalletAddress(address);
      setPlayerId(address);
      setDatBalance(balance.spendable);
    });

  const joinTable = async (overrideId?: string) => {
    if (busy) return;
    const seatedId = overrideId ?? playerId;
    setBusy(true);
    setError(null);
    try {
      if (!seatedId) throw new Error("Connect Sage and load DAT balance first");
      if (overrideId) setPlayerId(overrideId);
      const ticker = datToken?.ticker ?? "DAT";

      setStatus("Creating table…");
      const { tableId: id, config: tableConfig } = await api.createTable();
      const buyIn = tableConfig.minBuyInMojos;

      if (datBalance && BigInt(datBalance) < BigInt(buyIn)) {
        throw new Error(`Need at least ${formatDatMojos(buyIn, ticker)} in wallet`);
      }

      let buyInProof: BuyInProof | undefined;

      if (!datToken?.devBuyInEnabled && session && wcConfig && walletAddress) {
        const { message } = await api.buyInMessage({
          tableId: id,
          seatIndex: 0,
          buyInMojos: buyIn,
          address: walletAddress,
        });
        buyInProof = {
          address: walletAddress,
          message,
          signature: "",
          pubkey: "",
          datBalanceMojos: datBalance ?? undefined,
        };
        setStatus("Approve buy-in in Sage (check your phone)…");
        try {
          const signed = await signBuyInMessage(
            session,
            wcConfig.projectId,
            wcConfig.chainId,
            message,
            walletAddress,
          );
          buyInProof.signature = signed.signature;
          buyInProof.pubkey = signed.pubkey;
        } catch (signErr) {
          if (!datBalance || BigInt(datBalance) < BigInt(buyIn)) {
            throw signErr;
          }
          setStatus("Signature skipped — using wallet balance attestation…");
        }
      }

      setStatus("Seating you at the table…");
      await api.seatPlayer(id, seatedId, 0, buyIn, {
        buyInProof,
        devAck: datToken?.devBuyInEnabled,
      });
      await api.seatHouse(id, buyIn);
      setTableId(id);
      playerIdRef.current = seatedId;
      await refreshTable(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const startHandFlow = () => {
    if (!tableId || !playerId) return;
    run("Locking the deck…", async () => {
      setHandResult(null);
      setSnapshot(null);
      setHouseNote(null);
      setHandInProgress(true);
      try {
        const started = await api.startHand(tableId);
        setCommitHash(started.commitHash);
        setLocking(true);
        setStatus("Deck locked");
        await sleep(900);
        await api.submitSeed(tableId, playerId);
        await api.submitSeed(tableId, HOUSE_PLAYER_ID);
        setStatus("Dealing…");
        const dealt = await api.deal(tableId, playerId);
        applyActionResponse(dealt, datToken?.ticker);
        if (!dealt.hand) await refreshTable(tableId);
      } finally {
        setLocking(false);
      }
    });
  };

  const sendAction = (action: PlayerAction, amountMojos?: string) => {
    if (!tableId || !playerId || busy) return;
    setSecondsLeft(null);
    run(action, async () => {
      const response = await api.action(tableId, playerId, action, amountMojos);
      if (response.houseActions.length > 0) {
        setStatus("House is thinking…");
        await sleep(450);
      }
      applyActionResponse(response, datToken?.ticker);
      if (!response.hand) await refreshTable(tableId);
    });
  };

  const myTableSeat = tableSeats.find((s) => s.playerId === playerId);
  const tableStackMojos = myTableSeat?.stackMojos ?? null;

  const withdrawToSage = () => {
    if (!tableId || !playerId || !walletAddress) return;
    run("Withdrawing to Sage…", async () => {
      await refreshTable(tableId);
      const seat = (await api.getTable(tableId)).seats.find((s) => s.playerId === playerId);
      if (!seat) {
        throw new Error("You are no longer seated at this table");
      }
      const stackMojos = seat.stackMojos;

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

      if (result.mode === "offer" && result.offer && session && wcConfig) {
        if (result.offer.startsWith("mock-offer:")) {
          setStatus("Mock treasury offer (dev) — skipping Sage takeOffer");
        } else {
          setStatus("Accept treasury payout in Sage…");
          await takeOffer(session, wcConfig.projectId, wcConfig.chainId, result.offer, BigInt(result.feeMojos));
        }
      }

      setWithdrawResult(result);
      setTableId(null);
      setTableSeats([]);
      setHand(null);
      setHandResult(null);

      if (session && wcConfig && datToken?.assetId) {
        const { balance } = await findDatCatWallet(
          session,
          wcConfig.projectId,
          wcConfig.chainId,
          datToken.assetId,
        );
        setDatBalance(balance.spendable);
      }
    });
  };

  const me = hand?.players.find((p) => p.playerId === playerId);
  const currentBet = BigInt(hand?.currentBetMojos ?? 0);
  const myBet = BigInt(me?.betThisStreetMojos ?? 0);
  const toCall = currentBet - myBet;
  const canCheck = toCall <= 0n;
  const myStack = BigInt(me?.stackMojos ?? 0);

  const betRange = useMemo(
    () =>
      computeNlheBetRange({
        bigBlindMojos: DAT_BIG_BLIND_MOJOS,
        currentBetMojos: currentBet,
        myBetThisStreetMojos: myBet,
        myStackMojos: myStack,
      }),
    [currentBet, myBet, myStack],
  );

  const actionSeatPlayer =
    hand?.actionSeat != null
      ? hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded)
      : null;

  const isMyAction = actionSeatPlayer?.playerId === playerId;

  const sendRef = useRef(sendAction);
  sendRef.current = sendAction;

  useEffect(() => {
    if (!isMyAction) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(TURN_SECONDS);
    const id = window.setInterval(() => {
      setSecondsLeft((current) => (current == null ? current : Math.max(0, current - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isMyAction, hand?.handId, hand?.street, hand?.actionSeat]);

  useEffect(() => {
    if (secondsLeft !== 0 || !isMyAction || busy) return;
    sendRef.current(canCheck ? "check" : "fold");
  }, [secondsLeft, isMyAction, busy, canCheck]);

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

  const shownCards = (id: string): { cards: CardFace[]; faceDown: boolean; label: string | null } => {
    const shown = !hand ? handResult?.shownHands.find((s) => s.playerId === id) : undefined;
    if (shown && shown.holeCards.length > 0) {
      return { cards: shown.holeCards, faceDown: false, label: shown.handLabel };
    }
    const live = hand?.players.find((p) => p.playerId === id);
    if (live && live.holeCards.length > 0) {
      return { cards: live.holeCards, faceDown: false, label: null };
    }
    if (!hand && id === playerId) {
      const previous = snapshot?.players.find((p) => p.playerId === id);
      if (previous && previous.holeCards.length > 0) {
        return { cards: previous.holeCards, faceDown: false, label: null };
      }
    }
    return { cards: [], faceDown: true, label: null };
  };

  const stackFor = (id: string): string =>
    hand?.players.find((p) => p.playerId === id)?.stackMojos ??
    tableSeats.find((s) => s.playerId === id)?.stackMojos ??
    "0";

  const betFor = (id: string): string =>
    hand?.players.find((p) => p.playerId === id)?.betThisStreetMojos ?? "0";

  const seatView = (id: string, name: string): FeltSeat => {
    const live = hand?.players.find((p) => p.playerId === id);
    const cards = shownCards(id);
    return {
      name,
      stackMojos: stackFor(id),
      betMojos: betFor(id),
      holeCards: cards.cards,
      faceDown: cards.faceDown,
      folded: live?.folded ?? false,
      isDealer: hand?.dealerSeat === live?.seatIndex && live != null,
      acting: Boolean(hand && live && hand.actionSeat === live.seatIndex && !live.folded),
      allIn: live?.allIn ?? false,
      handLabel: cards.label,
    };
  };

  const feltBanner =
    !hand && handResult
      ? `${playerLabel(handResult.winnerId, playerId)} wins ${formatDatMojos(handResult.potMojos, datToken?.ticker)}${
          handResult.handLabel
            ? ` with ${handResult.handLabel}`
            : handResult.reason === "fold"
              ? " — the other hand folded"
              : ""
        }`
      : null;

  return (
    <div className={`app ${tableId ? "at-table" : ""}`}>
      <header>
        <h1>DAT Poker</h1>
        <p className="tagline">Sage WalletConnect · DAT buy-in · NLHE vs house · withdraw winnings</p>
        <p className={`api-status ${apiOk ? "ok" : apiOk === false ? "err" : ""}`}>
          API: {apiOk === null ? "checking…" : apiOk ? "connected" : "offline (run pnpm dev:api)"}
        </p>
      </header>

      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner info">{status}</div>}

      <section className="panel">
        <h2>Wallet</h2>
        {!wcConfig ? (
          <p className="muted">Set WALLETCONNECT_PROJECT_ID in API .env to enable Sage.</p>
        ) : !session ? (
          <button type="button" disabled={busy || !apiOk} onClick={connectSage}>
            Connect Sage (WalletConnect)
          </button>
        ) : (
          <>
            <p className="ok-text">WalletConnect session active</p>
            <div className="row">
              <button type="button" disabled={busy} className="secondary" onClick={loadDatBalance}>
                Load DAT balance
              </button>
              <button type="button" disabled={busy} className="secondary" onClick={disconnectSage}>
                Disconnect
              </button>
            </div>
            {walletAddress && (
              <p className="mono">
                Address: {shortAddress(walletAddress)}
                {datBalance != null && (
                  <>
                    {" "}
                    · {datToken?.ticker ?? "DAT"}: {formatDatMojos(datBalance, datToken?.ticker)}
                  </>
                )}
              </p>
            )}
          </>
        )}
        {datToken && (
          <p className="muted small">
            Network buy-in mode:{" "}
            {datToken.devBuyInEnabled ? "dev (signed proof optional)" : "mainnet (signed DAT proof required)"}
            {datToken.assetId && ` · asset ${datToken.assetId.slice(0, 8)}…`}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Table</h2>
        {!tableId ? (
          <div className="row">
            <button
              type="button"
              disabled={busy || !apiOk || !playerId || !datToken?.buyInReady}
              onClick={() => void joinTable()}
            >
              Buy in &amp; join table ({formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)})
            </button>
            {datToken?.devBuyInEnabled && (
              <button
                type="button"
                className="secondary"
                disabled={busy || !apiOk || !datToken.buyInReady}
                onClick={() => void joinTable("practice")}
              >
                Practice at the table
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="mono">Table ID: {tableId}</p>
            {tableStackMojos && (
              <p>
                Your table stack:{" "}
                <strong>{formatDatMojos(tableStackMojos, datToken?.ticker)}</strong>
              </p>
            )}
            {tableId && !hand && !handInProgress && tableStackMojos && walletAddress && (
              <div className="row">
                <button type="button" disabled={busy} onClick={withdrawToSage}>
                  Withdraw {formatDatMojos(tableStackMojos, datToken?.ticker)} to Sage
                </button>
              </div>
            )}
            {datToken?.devBuyInEnabled && playerId === "practice" && (
              <p className="muted small">Practice stack. Sage is not connected, so this table cannot cash out.</p>
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

      {tableId && playerId && (
        <FeltTable
          house={seatView(HOUSE_PLAYER_ID, "House")}
          hero={seatView(playerId, "You")}
          board={hand?.board ?? handResult?.board ?? []}
          street={hand?.street ?? null}
          potMojos={hand?.potMojos ?? (handResult && !hand ? handResult.potMojos : "0")}
          potAward={!hand && handResult ? (handResult.winnerId === playerId ? "you" : "house") : null}
          commitHash={hand?.commitHash ?? handResult?.commitHash ?? commitHash}
          locking={locking}
          houseNote={houseNote}
          secondsLeft={isMyAction ? secondsLeft : null}
          ticker={datToken?.ticker}
          banner={feltBanner}
        />
      )}

      {tableId && (
        <div className="actions-dock">
          {!hand && !locking && (
            <button type="button" disabled={busy} onClick={startHandFlow}>
              {handResult ? "New hand" : "Start hand vs house"}
            </button>
          )}
          {hand && isMyAction && (
            <div className="actions">
              <span>Your action{secondsLeft != null ? ` · ${secondsLeft}s` : ""}</span>
              <button type="button" disabled={busy} onClick={() => sendAction("fold")}>
                fold
              </button>
              {canCheck ? (
                <button type="button" disabled={busy} onClick={() => sendAction("check")}>
                  check
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => sendAction("call")}>
                  call {formatDatMojos(toCall.toString(), datToken?.ticker)}
                </button>
              )}
              {betRange.canBetOrRaise && (
                <>
                  <BetSlider
                    label={betRange.isOpeningBet ? "Bet size" : "Raise to"}
                    minMojos={betRange.minRaiseTo}
                    maxMojos={betRange.maxRaiseTo}
                    stepMojos={DAT_BIG_BLIND_MOJOS}
                    valueMojos={betAmountMojos}
                    ticker={datToken?.ticker}
                    disabled={busy}
                    onChange={setBetAmountMojos}
                  />
                  <button
                    type="button"
                    className="primary-bet"
                    disabled={busy}
                    onClick={() =>
                      sendAction(betRange.isOpeningBet ? "bet" : "raise", betAmountMojos.toString())
                    }
                  >
                    {betRange.isOpeningBet ? "bet" : "raise to"}{" "}
                    {formatDatMojos(betAmountMojos.toString(), datToken?.ticker)}
                  </button>
                </>
              )}
              {myStack > 0n && (
                <button type="button" disabled={busy} onClick={() => sendAction("all-in")}>
                  all-in
                </button>
              )}
            </div>
          )}
          {hand && !isMyAction && (
            <p className="muted">Waiting for the house…</p>
          )}
        </div>
      )}

      {wcUri && <QrConnectModal uri={wcUri} onClose={() => setWcUri(null)} />}

      <footer>
        <p>
          Configure API <code>.env</code> with WalletConnect + DAT asset id. Run <code>pnpm dev:api</code>,{" "}
          <code>pnpm dev:treasury</code>, and <code>pnpm dev:web</code>.
        </p>
      </footer>
    </div>
  );
}
