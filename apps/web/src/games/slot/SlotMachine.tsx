import { useCallback, useEffect, useRef, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { SymbolId } from "@dat-poker/slot-engine";
import { SLOT_SYMBOLS } from "@dat-poker/slot-engine";
import { usePlaySession } from "../../play/PlaySessionContext.js";
import { api } from "../../api.js";
import { paylineDisplayName, SlotPaylineOverlay } from "./SlotPaylineOverlay.js";
import { grossWinMojosFromSpin, resolveSpinDisplayWins, type SpinDisplayWin } from "./spin-display.js";
import { PAYLINE_COUNT } from "@dat-poker/slot-engine";
import { SlotPaytableModal } from "./SlotPaytableModal.js";
import "./slot.css";

const REEL_COUNT = 5;
const ROW_COUNT = 3;
const REEL_STOP_MS = [900, 1150, 1400, 1650, 1900];
const DEFAULT_BET_OPTIONS = ["1000", "2000", "5000", "10000", "20000"];

type WinTier = "none" | "win" | "big" | "mega" | "jackpot";

function tierLabel(tier: WinTier): string {
  switch (tier) {
    case "jackpot":
      return "PROGRESSIVE JACKPOT!";
    case "mega":
      return "MEGA WIN!";
    case "big":
      return "BIG WIN!";
    case "win":
      return "WINNER!";
    default:
      return "";
  }
}

function WinOverlay({
  tier,
  payoutMojos,
  ticker,
  onDone,
}: {
  tier: WinTier;
  payoutMojos: bigint;
  ticker?: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const ms = tier === "jackpot" ? 6500 : tier === "mega" ? 4500 : tier === "big" ? 3500 : 2200;
    const t = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(t);
  }, [tier, onDone]);

  if (tier === "none") return null;

  return (
    <div className={`slot-win-overlay tier-${tier}`} role="status" aria-live="polite">
      <div className="slot-win-rays" />
      <div className="slot-win-sparks" aria-hidden>
        {Array.from({ length: tier === "jackpot" ? 48 : 24 }).map((_, i) => (
          <span key={i} className="spark" style={{ ["--i" as string]: i }} />
        ))}
      </div>
      <div className="slot-win-card">
        <p className="slot-win-kicker">DAT Spirit Slots</p>
        <h2 className="slot-win-title">{tierLabel(tier)}</h2>
        <p className="slot-win-amount">+{formatDatMojos(payoutMojos.toString(), ticker)}</p>
      </div>
    </div>
  );
}

function SymbolCell({
  symbolId,
  highlighted,
  spinning,
}: {
  symbolId: SymbolId;
  highlighted: boolean;
  spinning: boolean;
}) {
  const sym = SLOT_SYMBOLS[symbolId];
  return (
    <div
      className={`slot-cell sym-${symbolId}${highlighted ? " win" : ""}${spinning ? " blur" : ""}`}
    >
      <span className="slot-emoji" aria-hidden>
        {sym.emoji}
      </span>
      <span className="slot-sym-label">{sym.label}</span>
    </div>
  );
}

function randomSymbol(): SymbolId {
  const ids = Object.keys(SLOT_SYMBOLS) as SymbolId[];
  return ids[Math.floor(Math.random() * ids.length)]!;
}

function symbolWinLabel(symbolId: string, count: number): string {
  const label = SLOT_SYMBOLS[symbolId as SymbolId]?.label ?? symbolId;
  return `${label} ×${count}`;
}

function buildSpinResultMessage(
  response: Awaited<ReturnType<typeof api.spinSlot>>,
  ticker: string,
  wins: SpinDisplayWin[],
  grossWinMojos: bigint,
  serverAuthoritative: boolean,
): { text: string; ok: boolean; warn?: boolean } {
  if (wins.length === 0) {
    return {
      text: "No win this spin — need 3+ matching symbols on a payline from the left (wilds count).",
      ok: false,
    };
  }
  if (grossWinMojos <= 0n) {
    return {
      text: `${wins.map((w) => `${paylineDisplayName(w.lineIndex)}: ${symbolWinLabel(w.symbol, w.count)} (${w.multiplier}×)`).join(" · ")} — Win detected on the reels; balance follows the server response.`,
      ok: true,
      warn: true,
    };
  }
  const parts: string[] = wins.map(
    (w) => `${paylineDisplayName(w.lineIndex)}: ${symbolWinLabel(w.symbol, w.count)} (${w.multiplier}×)`,
  );
  if (response.result.scatterCount >= 3 && response.result.scatterMultiplier > 0) {
    parts.push(`Scatter ×${response.result.scatterCount} (${response.result.scatterMultiplier}×)`);
  }
  if (response.wonProgressive) {
    parts.push("Progressive jackpot");
  }
  const detail = parts.join(" · ");
  if (!serverAuthoritative) {
    return {
      text: `${detail} — Should pay about ${formatDatMojos(grossWinMojos.toString(), ticker)}. If your balance did not change, restart the API after redeploy (old slot-engine).`,
      ok: true,
      warn: true,
    };
  }
  const net = BigInt(response.netMojos);
  const netLabel =
    net >= 0n
      ? `Net +${formatDatMojos(net.toString(), ticker)}`
      : `Net ${formatDatMojos(net.toString(), ticker)}`;
  return {
    text: `${detail} — Won ${formatDatMojos(grossWinMojos.toString(), ticker)} · ${netLabel} after ${formatDatMojos(response.betMojos, ticker)} wager`,
    ok: true,
  };
}

export function SlotMachine({
  ticker = "DAT",
  playerId,
}: {
  ticker?: string;
  playerId: string | null;
}) {
  const { session, refreshSession } = usePlaySession();
  const betOptions = session?.betOptionsMojos ?? DEFAULT_BET_OPTIONS;
  const [selectedBetMojos, setSelectedBetMojos] = useState(
    session?.defaultBetMojos ?? betOptions[0] ?? "1000",
  );

  useEffect(() => {
    if (session?.defaultBetMojos) {
      setSelectedBetMojos(session.defaultBetMojos);
    }
  }, [session?.defaultBetMojos]);

  const [grid, setGrid] = useState<SymbolId[][]>(() =>
    Array.from({ length: REEL_COUNT }, () => Array.from({ length: ROW_COUNT }, () => randomSymbol())),
  );
  const [spinning, setSpinning] = useState(false);
  const [stoppedReels, setStoppedReels] = useState(REEL_COUNT);
  const [overlayTier, setOverlayTier] = useState<WinTier>("none");
  const [overlayPayout, setOverlayPayout] = useState(0n);
  const [status, setStatus] = useState("");
  const [spinResult, setSpinResult] = useState<{ text: string; ok: boolean; warn?: boolean } | null>(
    null,
  );
  const [highlights, setHighlights] = useState<Set<string>>(() => new Set());
  const [winningLineIndices, setWinningLineIndices] = useState<ReadonlySet<number>>(() => new Set());
  const [showPaylines, setShowPaylines] = useState(true);
  const [paytableOpen, setPaytableOpen] = useState(false);
  const timersRef = useRef<number[]>([]);

  const balanceMojos = BigInt(
    session?.accountBalanceMojos ?? session?.stackMojos ?? "0",
  );
  const betMojos = BigInt(selectedBetMojos);
  const jackpotMojos = session?.progressiveJackpotMojos ?? "0";
  const canSpin =
    Boolean(playerId && session?.active) &&
    !spinning &&
    !session?.handInProgress &&
    balanceMojos >= betMojos;

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const onSpin = useCallback(async () => {
    if (!canSpin || !playerId) return;
    clearTimers();
    setOverlayTier("none");
    setSpinResult(null);
    setHighlights(new Set());
    setWinningLineIndices(new Set());
    setSpinning(true);
    setStoppedReels(0);
    setStatus("Spinning…");

    try {
      const response = await api.spinSlot(playerId, selectedBetMojos);
      const resultGrid = response.result.grid as SymbolId[][];

      const tick = window.setInterval(() => {
        setGrid(
          Array.from({ length: REEL_COUNT }, () =>
            Array.from({ length: ROW_COUNT }, () => randomSymbol()),
          ),
        );
      }, 80);
      timersRef.current.push(tick);

      REEL_STOP_MS.forEach((delay, reelIndex) => {
        const t = window.setTimeout(() => {
          setStoppedReels(reelIndex + 1);
          setGrid((prev) => {
            const next = prev.map((col) => [...col]) as SymbolId[][];
            for (let row = 0; row < ROW_COUNT; row++) {
              next[reelIndex]![row] = resultGrid[reelIndex]![row]!;
            }
            return next;
          });
          if (reelIndex === REEL_COUNT - 1) {
            window.clearInterval(tick);
            setSpinning(false);
            setStatus("");
            void refreshSession(playerId);

            const { wins, serverAuthoritative } = resolveSpinDisplayWins(response, resultGrid);
            const grossWinMojos = grossWinMojosFromSpin(response, betMojos, resultGrid);
            const winCells = new Set<string>();
            const winLines = new Set<number>();
            for (const w of wins) {
              winLines.add(w.lineIndex);
              for (const cell of w.cells) {
                winCells.add(`${cell.reel}-${cell.row}`);
              }
            }
            setHighlights(winCells);
            setWinningLineIndices(winLines);
            setSpinResult(
              buildSpinResultMessage(response, ticker, wins, grossWinMojos, serverAuthoritative),
            );

            const winMojos = grossWinMojos;
            const tier = response.result.winTier as WinTier;
            if (winMojos > 0n) {
              setOverlayTier(tier === "none" ? "win" : tier);
              setOverlayPayout(winMojos);
            }
          }
        }, delay);
        timersRef.current.push(t);
      });
    } catch (e) {
      setSpinning(false);
      setStatus("");
      setOverlayTier("none");
      setStatus((e as Error).message);
    }
  }, [canSpin, clearTimers, playerId, refreshSession, selectedBetMojos]);

  return (
    <div className="slot-page">
      <header className="slot-header">
        <div>
          <h1 className="slot-title">Spirit Slots</h1>
          <p className="slot-tagline">
            Uses your table account DAT · pick 1–20 {ticker} per spin · prizes scale with your bet ·
            5× Lucky 7 center line wins the progressive ·{" "}
            <button
              type="button"
              className="slot-paytable-link"
              onClick={() => setPaytableOpen(true)}
            >
              Paytable &amp; rules
            </button>
          </p>
        </div>
        <div className="slot-credits">
          <span className="slot-credits-label">Account balance</span>
          <strong>{formatDatMojos(balanceMojos.toString(), ticker)}</strong>
        </div>
      </header>

      <div className="slot-progressive panel">
        <h2>Progressive jackpot</h2>
        <p className="slot-jackpot-amount">{formatDatMojos(jackpotMojos, ticker)}</p>
        <p className="muted small">5% of each spin feeds the pot</p>
      </div>

      {!playerId && (
        <p className="banner info">Sign in on the Play tab to use your account DAT.</p>
      )}
      {playerId && balanceMojos < betMojos && (
        <p className="banner info">
          Not enough DAT for a {formatDatMojos(selectedBetMojos, ticker)} spin. Redeem or cash out
          chips on the Play tab.
        </p>
      )}
      {session?.handInProgress && (
        <p className="banner error">Finish your poker hand before spinning.</p>
      )}
      {status && !spinning && status.length > 0 && <div className="banner error">{status}</div>}

      <div className="slot-spin-result-slot" role="status" aria-live="polite">
        <div
          className={`banner slot-spin-result${
            spinning
              ? " pending"
              : spinResult?.warn
                ? " warn"
                : spinResult?.ok
                  ? " ok"
                  : spinResult
                    ? " miss"
                    : " idle"
          }`}
        >
          {spinning
            ? "Spinning…"
            : spinResult?.text ??
              "Results show here after each spin — 3+ on a payline from the left (wilds count)."}
        </div>
      </div>

      <div className={`slot-cabinet${spinning ? " spinning" : ""}${overlayTier !== "none" ? " celebrate" : ""}`}>
        <div className="slot-marquee">
          <span className="slot-marquee-glow">★ DAT SPIRIT SLOTS ★</span>
        </div>

        <div className="slot-window">
          <label className="slot-payline-toggle">
            <input
              type="checkbox"
              checked={showPaylines}
              onChange={(e) => setShowPaylines(e.target.checked)}
            />
            Show all {PAYLINE_COUNT} paylines (your wager covers every line)
          </label>
          <div className="slot-reels-wrap">
            <div className="slot-reels">
              {Array.from({ length: REEL_COUNT }).map((_, reel) => (
                <div
                  key={reel}
                  className={`slot-reel${reel >= stoppedReels && spinning ? " active" : ""}`}
                >
                  {Array.from({ length: ROW_COUNT }).map((_, row) => (
                    <SymbolCell
                      key={row}
                      symbolId={grid[reel]![row]!}
                      highlighted={highlights.has(`${reel}-${row}`)}
                      spinning={spinning && reel >= stoppedReels}
                    />
                  ))}
                </div>
              ))}
            </div>
            <SlotPaylineOverlay
              showLines={showPaylines && !spinning}
              winningLineIndices={winningLineIndices}
            />
          </div>
        </div>

        <div className="slot-controls">
          <p className="slot-payline-legend">
            {formatDatMojos(selectedBetMojos, ticker)} total wager · split across {PAYLINE_COUNT}{" "}
            lines · match 3+ from the left on any line (✨ wild)
          </p>
          <p className="slot-bet-label">Bet per spin</p>
          <div className="slot-bet-options" role="group" aria-label="Bet per spin">
            {betOptions.map((mojos) => {
              const active = mojos === selectedBetMojos;
              return (
                <button
                  key={mojos}
                  type="button"
                  className={`slot-bet-chip${active ? " active" : ""}`}
                  disabled={spinning}
                  aria-pressed={active}
                  onClick={() => setSelectedBetMojos(mojos)}
                >
                  {formatDatMojos(mojos, ticker)}
                </button>
              );
            })}
          </div>
          <p className="slot-total-bet">
            Wager: <strong>{formatDatMojos(selectedBetMojos, ticker)}</strong>
          </p>
          <button type="button" className="slot-spin-btn" disabled={!canSpin} onClick={() => void onSpin()}>
            {spinning ? "Spinning…" : "SPIN"}
          </button>
        </div>
      </div>

      {overlayTier !== "none" && (
        <WinOverlay
          tier={overlayTier}
          payoutMojos={overlayPayout}
          ticker={ticker}
          onDone={() => setOverlayTier("none")}
        />
      )}

      <SlotPaytableModal
        open={paytableOpen}
        onClose={() => setPaytableOpen(false)}
        totalBetMojos={betMojos}
        ticker={ticker}
        progressiveJackpotMojos={jackpotMojos}
      />
    </div>
  );
}
