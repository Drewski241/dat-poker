import { useCallback, useEffect, useMemo, useState } from "react";
import { computeNlheBetRange, DAT_TABLE_DEFAULTS, formatDatMojos } from "@dat-poker/shared";
import { api, type BuyInProof, type DatTokenInfo, type HandResult, type HandState, type PlayerAction, type TableSeat, type WithdrawResult } from "./api.js";
import { BetSlider } from "./components/BetSlider.js";
import { QrConnectModal } from "./components/QrConnectModal.js";
import {
  beginWalletConnect,
  disconnectWallet,
  findDatCatWallet,
  getWalletAddress,
  restoreSession,
  signBuyInMessage,
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

  const treasuryFundedBuyIn = datToken?.buyInFunding === "treasury";

  const refreshTreasuryBudget = useCallback(async (address?: string | null) => {
    const dat = await api.datToken(address ?? undefined);
    setDatToken(dat);
  }, []);

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

  const refreshTable = useCallback(async (id: string) => {
    const t = await api.getTable(id);
    setHand(t.hand);
    setTableSeats(t.seats);
    setHandInProgress(t.handInProgress);
    if (t.lastHandResult) setHandResult(t.lastHandResult);
  }, []);

  const applyActionResponse = useCallback(
    (response: { hand: HandState | null; lastHandResult: HandResult | null }) => {
      setHand(response.hand);
      if (response.lastHandResult) setHandResult(response.lastHandResult);
    },
    [],
  );

  useEffect(() => {
    if (!tableId || !hand || !playerId || busy) return;
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
    if (!actor || actor.playerId !== HOUSE_PLAYER_ID) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        setBusy(true);
        try {
          const currentBet = BigInt(hand.currentBetMojos);
          const house = hand.players.find((p) => p.playerId === HOUSE_PLAYER_ID);
          const houseBet = BigInt(house?.betThisStreetMojos ?? 0);
          const toCall = currentBet - houseBet;
          let response;
          if (toCall > 0n) {
            response = await api.action(tableId, HOUSE_PLAYER_ID, "call");
          } else {
            response = await api.action(tableId, HOUSE_PLAYER_ID, "check");
          }
          applyActionResponse(response);
          if (!response.hand) await refreshTable(tableId);
        } catch {
          try {
            const response = await api.action(tableId, HOUSE_PLAYER_ID, "fold");
            applyActionResponse(response);
            if (!response.hand) await refreshTable(tableId);
          } catch {
            /* ignore */
          }
        } finally {
          setBusy(false);
        }
      })();
    }, 600);

    return () => window.clearTimeout(timer);
  }, [tableId, hand, playerId, busy, refreshTable, applyActionResponse]);

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
    run(treasuryFundedBuyIn ? "Connecting wallet…" : "Loading DAT balance…", async () => {
      if (!session || !wcConfig) {
        throw new Error("Connect Sage via WalletConnect first");
      }
      if (treasuryFundedBuyIn) {
        const address = await getWalletAddress(session, wcConfig.projectId, wcConfig.chainId);
        setWalletAddress(address);
        setPlayerId(address);
        setDatBalance(null);
        await refreshTreasuryBudget(address);
        return;
      }
      if (!datToken?.assetId) {
        throw new Error("Configure DAT_GOVERNANCE_TOKEN_ASSET_ID on API");
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

  const joinOpenTable = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!playerId) throw new Error("Connect Sage and identify your wallet first");

      const buyIn = datToken?.minBuyInMojos ?? DAT_TABLE_DEFAULTS.minBuyInMojos.toString();
      if (!treasuryFundedBuyIn && datBalance && BigInt(datBalance) < BigInt(buyIn)) {
        throw new Error(`Need at least ${formatDatMojos(buyIn, datToken?.ticker)} in wallet`);
      }

      setStatus("Finding an open table…");
      let buyInProof: BuyInProof | undefined;
      let tableIdToJoin: string | undefined;
      let seatIndexToJoin: number | undefined;

      if (!treasuryFundedBuyIn && !datToken?.devBuyInEnabled && session && wcConfig && walletAddress) {
        const preview = await api.joinOpenTablePreview(playerId, buyIn);
        if (preview.alreadySeated) {
          setTableId(preview.tableId);
          await refreshTable(preview.tableId);
          await refreshTreasuryBudget(playerId);
          return;
        }
        tableIdToJoin = preview.tableId;
        seatIndexToJoin = preview.seatIndex;
        const { message } = await api.buyInMessage({
          tableId: preview.tableId,
          seatIndex: preview.seatIndex,
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

      setStatus("Joining open table…");
      const result = await api.joinOpenTable(playerId, {
        tableId: tableIdToJoin,
        seatIndex: seatIndexToJoin,
        buyInMojos: buyIn,
        buyInProof,
        devAck: datToken?.devBuyInEnabled,
      });

      setTableId(result.tableId);
      await refreshTable(result.tableId);
      await refreshTreasuryBudget(playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const startHandFlow = () => {
    if (!tableId || !playerId) return;
    run("Starting hand…", async () => {
      setHandResult(null);
      await api.startHand(tableId);
      await api.submitSeed(tableId, playerId);
      await api.submitSeed(tableId, HOUSE_PLAYER_ID);
      const { hand: dealt } = await api.deal(tableId);
      setHand(dealt);
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

      if (session && wcConfig && datToken?.assetId && !treasuryFundedBuyIn) {
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
      <header>
        <h1>DAT Poker</h1>
        <p className="tagline">
          Sage WalletConnect · {treasuryFundedBuyIn ? "treasury-funded buy-in" : "DAT buy-in"} · NLHE vs
          house · withdraw winnings
        </p>
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
                {treasuryFundedBuyIn ? "Identify wallet" : "Load DAT balance"}
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
                {treasuryFundedBuyIn && datBalance == null && (
                  <> · treasury supplies table chips</>
                )}
              </p>
            )}
          </>
        )}
        {datToken && (
          <p className="muted small">
            Buy-in funding:{" "}
            {treasuryFundedBuyIn
              ? "treasury host (no player DAT required)"
              : datToken.devBuyInEnabled
                ? "dev (signed proof optional)"
                : "player wallet (signed DAT proof required)"}
            {datToken.assetId && ` · asset ${datToken.assetId.slice(0, 8)}…`}
            {treasuryFundedBuyIn && datToken.treasuryBuyInBudget && (
              <>
                {" "}
                · treasury budget: {formatDatMojos(datToken.treasuryBuyInBudget.remainingMojos, datToken.ticker)}
                remaining / {formatDatMojos(datToken.treasuryBuyInBudget.limitMojos, datToken.ticker)} (24h
                {datToken.treasuryBuyInBudget.scope === "player" ? ", per wallet" : ", shared"})
              </>
            )}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Table</h2>
        {!tableId ? (
          <>
            <button
              type="button"
              disabled={busy || !apiOk || !playerId || !datToken?.buyInReady}
              onClick={() => void joinOpenTable()}
            >
              Join open table ({formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)}
              {treasuryFundedBuyIn ? ", treasury-funded" : ""})
            </button>
            <p className="muted small">No invite link needed — you are seated at the next open public table.</p>
          </>
        ) : (
          <>
            <p className="mono">Table ID: {tableId}</p>
            {tableStackMojos && (
              <p>
                Your table stack:{" "}
                <strong>{formatDatMojos(tableStackMojos, datToken?.ticker)}</strong>
              </p>
            )}
            {tableId && !hand && !handInProgress && tableStackMojos && (
              <div className="row">
                <button type="button" disabled={busy} onClick={withdrawToSage}>
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
              <button type="button" disabled={busy} onClick={startHandFlow}>
                {handResult ? "New hand" : "Start hand vs house"}
              </button>
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
        <p>
          For external players: set <code>DAT_BUYIN_FUNDING=treasury</code> and expose API/web ports — anyone can join an open table. Run <code>pnpm dev:api</code>, <code>pnpm dev:treasury</code>, and{" "}
          <code>pnpm dev:web</code>.
        </p>
      </footer>
    </div>
  );
}
