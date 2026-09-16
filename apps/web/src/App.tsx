import { useCallback, useEffect, useMemo, useState } from "react";
import { computeNlheBetRange, DAT_TABLE_DEFAULTS, formatDatMojos } from "@dat-poker/shared";
import { api, type BuyInProof, type DatTokenInfo, type HandResult, type HandState, type PlayerAction, type TableSeat, type WithdrawResult } from "./api.js";
import { BetSlider } from "./components/BetSlider.js";
import { QrConnectModal } from "./components/QrConnectModal.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";
import {
  beginWalletConnect,
  disconnectWallet,
  loadPlayerWallet,
  restoreSession,
  signRedeemMessage,
  signWithdrawMessage,
  takeOffer,
  type WcSession,
} from "./wallet/chia-wallet.js";

const HOUSE_PLAYER_ID = "dat-poker:house";
const DAT_BIG_BLIND_MOJOS = DAT_TABLE_DEFAULTS.bigBlindMojos;

function playerLabel(id: string, youId: string | null): string {
  if (id === youId) return "You";
  if (id === HOUSE_PLAYER_ID) return "House";
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function cardLabel(card: { rank: string; suit: string }): string {
  const suit = { c: "♣", d: "♦", h: "♥", s: "♠" }[card.suit] ?? card.suit;
  return `${card.rank}${suit}`;
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
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [datBalance, setDatBalance] = useState<string | null>(null);
  const [accountMojos, setAccountMojos] = useState<string | null>(null);
  const [redeemedToday, setRedeemedToday] = useState(false);

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

  const refreshAccount = useCallback(async (address: string) => {
    const acc = await api.account(address);
    setAccountMojos(acc.balanceMojos);
    setRedeemedToday(acc.redeemedToday);
  }, []);

  const refreshTable = useCallback(async (id: string) => {
    const t = await api.getTable(id, playerId ?? undefined);
    setHand(t.hand);
    setTableSeats(t.seats);
    setHandInProgress(t.handInProgress);
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
      setAccountMojos(null);
      setRedeemedToday(false);
      setPlayerId(null);
    });

  const loadDatBalance = () =>
    run("Loading wallet…", async () => {
      if (!session || !wcConfig) {
        throw new Error("Connect Sage first");
      }
      const { balance, address } = await loadPlayerWallet(
        session,
        wcConfig.projectId,
        wcConfig.chainId,
        datToken?.assetId,
      );
      setWalletAddress(address);
      setPlayerId(address);
      setDatBalance(balance.spendable);
      await refreshAccount(address);
    });

  const redeemDaily = () =>
    run("Redeeming 5000 DAT…", async () => {
      if (!playerId) throw new Error("Connect Sage and load wallet first");
      const ticker = datToken?.ticker ?? "DAT";
      let redeemProof: BuyInProof | undefined;
      if (session && wcConfig) {
        const { message, amountMojos } = await api.redeemMessage(playerId);
        setStatus(`Approve ${formatDatMojos(amountMojos, ticker)} redeem in Sage…`);
        try {
          const signed = await signRedeemMessage(
            session,
            wcConfig.projectId,
            wcConfig.chainId,
            message,
            playerId,
          );
          redeemProof = {
            address: playerId,
            message,
            signature: signed.signature,
            pubkey: signed.pubkey,
          };
        } catch (signErr) {
          if (!datToken?.devBuyInEnabled) throw signErr;
        }
      }
      const result = await api.redeem(playerId, {
        redeemProof,
        devAck: datToken?.devBuyInEnabled,
      });
      setAccountMojos(result.balanceMojos);
      setRedeemedToday(true);
      setStatus(result.note);
    });

  const joinTable = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!playerId) throw new Error("Connect Sage and load wallet first");
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
      setTableSeats(joined.seats);
      setHand(joined.hand);
      setHandInProgress(joined.handInProgress);
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
      const dealt = await api.goHand(tableId, playerId);
      setHand(dealt.hand);
      if (dealt.lastHandResult) setHandResult(dealt.lastHandResult);
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
  const handsPlayed = myTableSeat?.handsPlayed ?? 0;
  const handsRequired = myTableSeat?.handsRequired ?? 0;
  const playthroughRemaining = myTableSeat?.playthroughRemaining ?? 0;

  const withdrawToSage = () => {
    if (!tableId || !playerId || !walletAddress) return;
    run("Withdrawing to Sage…", async () => {
      await refreshTable(tableId);
      const seat = (await api.getTable(tableId, playerId)).seats.find((s) => s.playerId === playerId);
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

  useEffect(() => {
    document.title = isBeta ? "DAT Poker beta" : "DAT Poker";
  }, [isBeta]);

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

  return (
    <div className="app">
      {isBeta && (
        <div className="beta-banner" role="status">
          Public beta — software under development. Tables live in memory and reset when
          the server restarts. Dev buy-in is for testing, not real-money settlement.
        </div>
      )}
      <header>
        {onNavigate && <SiteNav page="play" onNavigate={onNavigate} />}
        <h1>DAT Poker{isBeta ? " beta" : ""}</h1>
        <p className="tagline">Sage · daily 5000 DAT redeem · 6-max vs house or humans</p>
        <p className={`api-status ${apiOk ? "ok" : apiOk === false ? "err" : ""}`}>
          API: {apiOk === null ? "checking…" : apiOk ? "connected" : "offline (run pnpm dev:api)"}
        </p>
      </header>

      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner info">{status}</div>}

      <section className="panel">
        <h2>Wallet</h2>
        {pageIsHttp && (
          <p className="muted">
            Sage WalletConnect needs HTTPS. Open the <code>https://</code> site
            (for example <code>https://datspiritpoker.com</code>), not <code>http://</code>
            plus the Elastic IP.
          </p>
        )}
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
                Load wallet
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
                    · Sage {datToken?.ticker ?? "DAT"}: {formatDatMojos(datBalance, datToken?.ticker)}
                  </>
                )}
              </p>
            )}
            {accountMojos != null && (
              <p>
                Table account:{" "}
                <strong>{formatDatMojos(accountMojos, datToken?.ticker)}</strong>
                {redeemedToday ? " · daily redeem used" : ""}
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
            </div>
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
                      ? `${playerLabel(seated.playerId, playerId)} · ${formatDatMojos(seated.stackMojos, datToken?.ticker)}`
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
                Play-through: {handsPlayed}/{handsRequired} hands (one hand per DAT token of buy-in)
                {playthroughRemaining > 0 ? ` — ${playthroughRemaining} remaining` : " — met"}
              </p>
            )}
            {tableId && !hand && !handInProgress && tableStackMojos && (
              <div className="row">
                <button
                  type="button"
                  disabled={busy || playthroughRemaining > 0}
                  onClick={withdrawToSage}
                >
                  Withdraw {formatDatMojos(tableStackMojos, datToken?.ticker)} to Sage
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
                {withdrawResult.mode === "offer" ? " (on-chain via offer)" : " (ledger)"}
              </>
            )}
            . {withdrawResult.note}
          </div>
        )}
      </section>

      {tableId && (
        <section className="panel">
          <h2>Hand</h2>
          {!hand ? (
            <>
              {handResult && (
                <div className="banner win">
                  <strong>{playerLabel(handResult.winnerId, playerId)}</strong> wins{" "}
                  {formatDatMojos(handResult.potMojos, datToken?.ticker)}
                  {handResult.reason === "showdown" ? " at showdown" : " (fold)"}
                </div>
              )}
              <button type="button" disabled={busy || tableSeats.length < 2} onClick={startHandFlow}>
                {handResult ? "New hand" : "Deal hand"}
              </button>
              <p className="muted small">
                6-max: house fills if you are alone; another human can sit an empty seat between hands.
              </p>
            </>
          ) : (
            <>
              <p>
                Street: <strong>{hand.street}</strong> · Pot:{" "}
                <strong>{formatDatMojos(hand.potMojos, datToken?.ticker)}</strong>
              </p>
              {hand.board.length > 0 && <p>Board: {hand.board.map(cardLabel).join(" ")}</p>}
              <ul className="players">
                {hand.players.map((p) => (
                  <li key={p.playerId}>
                    <strong>{p.playerId === playerId ? "You" : p.playerId === HOUSE_PLAYER_ID ? "House" : p.playerId}</strong>
                    {p.playerId === playerId && p.holeCards.length > 0 && (
                      <span className="cards"> {p.holeCards.map(cardLabel).join(" ")}</span>
                    )}
                    {p.folded ? " — folded" : ""}
                    <span className="stack"> stack {formatDatMojos(p.stackMojos, datToken?.ticker)}</span>
                  </li>
                ))}
              </ul>
              {isMyAction && (
                <div className="actions">
                  <span>Your action</span>
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
                          sendAction(
                            betRange.isOpeningBet ? "bet" : "raise",
                            betAmountMojos.toString(),
                          )
                        }
                      >
                        {betRange.isOpeningBet ? "bet" : "raise to"}{" "}
                        {formatDatMojos(betAmountMojos.toString(), datToken?.ticker)}
                      </button>
                    </>
                  )}
                  {myStack > 0n && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => sendAction("all-in")}
                    >
                      all-in
                    </button>
                  )}
                </div>
              )}
              {!isMyAction && actionSeatPlayer && (
                <p className="muted">Waiting for {playerLabel(actionSeatPlayer.playerId, playerId)}…</p>
              )}
            </>
          )}
        </section>
      )}

      {wcUri && <QrConnectModal uri={wcUri} onClose={() => setWcUri(null)} />}

      <footer>
        {isBeta ? (
          <p>
            DAT POKER public beta. Redeem 5000 DAT per UTC day into a table account (not an
            on-chain CAT send). 6-max: play the house or another human on an open seat.
          </p>
        ) : (
          <p>
            Configure API <code>.env</code> with WalletConnect + DAT asset id. Run{" "}
            <code>pnpm dev:api</code>, <code>pnpm dev:treasury</code>, and{" "}
            <code>pnpm dev:web</code>.
          </p>
        )}
      </footer>
    </div>
  );
}
