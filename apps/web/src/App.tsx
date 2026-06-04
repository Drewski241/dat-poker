import { useCallback, useEffect, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import { api, type BuyInProof, type DatTokenInfo, type HandState, type PlayerAction } from "./api.js";
import { QrConnectModal } from "./components/QrConnectModal.js";
import {
  beginWalletConnect,
  disconnectWallet,
  findDatCatWallet,
  restoreSession,
  signBuyInMessage,
  type WcSession,
} from "./wallet/chia-wallet.js";

const HOUSE_PLAYER_ID = "dat-poker:house";

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
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hand, setHand] = useState<HandState | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    if (!tableId || !hand || !playerId || busy) return;
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
    if (!actor || actor.playerId !== HOUSE_PLAYER_ID) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        setBusy(true);
        try {
          const action: PlayerAction = "check";
          const { hand: next } = await api.action(tableId, HOUSE_PLAYER_ID, action);
          setHand(next);
          if (!next) await refreshTable(tableId);
        } catch {
          try {
            const { hand: next } = await api.action(tableId, HOUSE_PLAYER_ID, "fold");
            setHand(next);
            if (!next) await refreshTable(tableId);
          } catch {
            /* ignore */
          }
        } finally {
          setBusy(false);
        }
      })();
    }, 600);

    return () => window.clearTimeout(timer);
  }, [tableId, hand, playerId, busy, refreshTable]);

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

  const joinTable = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!playerId) throw new Error("Connect Sage and load DAT balance first");
      const buyIn = datToken?.minBuyInMojos ?? "1000000";
      const ticker = datToken?.ticker ?? "DAT";
      if (datBalance && BigInt(datBalance) < BigInt(buyIn)) {
        throw new Error(`Need at least ${formatDatMojos(buyIn, ticker)} in wallet`);
      }

      setStatus("Creating table…");
      const { tableId: id } = await api.createTable();
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
      await api.seatPlayer(id, playerId, 0, buyIn, {
        buyInProof,
        devAck: datToken?.devBuyInEnabled,
      });
      await api.seatHouse(id, buyIn);
      setTableId(id);
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
    run("Starting hand…", async () => {
      await api.startHand(tableId);
      await api.submitSeed(tableId, playerId);
      await api.submitSeed(tableId, HOUSE_PLAYER_ID);
      const { hand: dealt } = await api.deal(tableId);
      setHand(dealt);
    });
  };

  const sendAction = (action: PlayerAction) => {
    if (!tableId || !playerId) return;
    run(action, async () => {
      const { hand: next } = await api.action(tableId, playerId, action);
      setHand(next);
      if (!next) await refreshTable(tableId);
    });
  };

  const actionSeatPlayer =
    hand?.actionSeat != null
      ? hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded)
      : null;

  const isMyAction = actionSeatPlayer?.playerId === playerId;

  return (
    <div className="app">
      <header>
        <h1>DAT Poker</h1>
        <p className="tagline">Sage WalletConnect · DAT buy-in · NLHE vs house</p>
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
          <button
            type="button"
            disabled={busy || !apiOk || !playerId || !datToken?.buyInReady}
            onClick={() => void joinTable()}
          >
            Buy in &amp; join table ({formatDatMojos(datToken?.minBuyInMojos ?? "1000000", datToken?.ticker)})
          </button>
        ) : (
          <p className="mono">Table ID: {tableId}</p>
        )}
      </section>

      {tableId && (
        <section className="panel">
          <h2>Hand</h2>
          {!hand ? (
            <button type="button" disabled={busy} onClick={startHandFlow}>
              Start hand vs house
            </button>
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
                  {(["fold", "check", "call"] as const).map((a) => (
                    <button key={a} type="button" disabled={busy} onClick={() => sendAction(a)}>
                      {a}
                    </button>
                  ))}
                </div>
              )}
              {!isMyAction && actionSeatPlayer && (
                <p className="muted">Waiting for {actionSeatPlayer.playerId === HOUSE_PLAYER_ID ? "house" : "opponent"}…</p>
              )}
              {!actionSeatPlayer && hand && (
                <button type="button" disabled={busy} onClick={startHandFlow}>
                  New hand
                </button>
              )}
            </>
          )}
        </section>
      )}

      {wcUri && <QrConnectModal uri={wcUri} onClose={() => setWcUri(null)} />}

      <footer>
        <p>
          Configure API <code>.env</code> with WalletConnect + DAT asset id. Run <code>pnpm dev:api</code> and{" "}
          <code>pnpm dev:web</code>.
        </p>
      </footer>
    </div>
  );
}
