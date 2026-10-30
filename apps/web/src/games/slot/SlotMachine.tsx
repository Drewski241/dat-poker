import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import { PAYLINES } from "./paylines.js";
import {
  spin,
  winTier,
  type Grid,
  type LineWin,
  type SpinResult,
  type WinTier,
} from "./slot-engine.js";
import { REEL_STRIP, SLOT_SYMBOLS, type SymbolId } from "./symbols.js";
import "./slot.css";

const STARTING_CREDITS = 10_000n;
const MOJOS_PER_CREDIT = 1000n;
const DEFAULT_LINE_BET = 10n;
const REEL_COUNT = 5;
const ROW_COUNT = 3;

const REEL_STOP_MS = [900, 1150, 1400, 1650, 1900];

function randomStripSymbol(): SymbolId {
  return REEL_STRIP[Math.floor(Math.random() * REEL_STRIP.length)]!;
}

function tierLabel(tier: WinTier): string {
  switch (tier) {
    case "jackpot":
      return "JACKPOT!";
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
    const ms = tier === "jackpot" ? 5500 : tier === "mega" ? 4500 : tier === "big" ? 3500 : 2200;
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

function buildHighlightSet(wins: LineWin[]): Set<string> {
  const set = new Set<string>();
  for (const w of wins) {
    for (const c of w.cells) {
      set.add(`${c.reel}-${c.row}`);
    }
  }
  return set;
}

export function SlotMachine({ ticker = "DAT" }: { ticker?: string }) {
  const [credits, setCredits] = useState(STARTING_CREDITS);
  const [lineBet, setLineBet] = useState(DEFAULT_LINE_BET);
  const [grid, setGrid] = useState<Grid>(() =>
    Array.from({ length: REEL_COUNT }, () =>
      Array.from({ length: ROW_COUNT }, () => randomStripSymbol()),
    ),
  );
  const [spinning, setSpinning] = useState(false);
  const [stoppedReels, setStoppedReels] = useState(REEL_COUNT);
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [overlayTier, setOverlayTier] = useState<WinTier>("none");
  const [overlayPayout, setOverlayPayout] = useState(0n);
  const timersRef = useRef<number[]>([]);

  const totalBet = lineBet * BigInt(PAYLINES.length);
  const totalBetMojos = totalBet * MOJOS_PER_CREDIT;
  const canSpin = !spinning && credits >= totalBet;

  const highlights = useMemo(
    () => (lastResult && !spinning ? buildHighlightSet(lastResult.lineWins) : new Set<string>()),
    [lastResult, spinning],
  );

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const finishSpin = useCallback(
    (result: SpinResult) => {
      setGrid(result.grid);
      setLastResult(result);
      setSpinning(false);
      setStoppedReels(REEL_COUNT);

      if (result.totalPayout > 0) {
        const winCredits = BigInt(result.totalPayout);
        setCredits((c) => c - totalBet + winCredits);
        const tier = winTier(result.totalMultiplier);
        if (tier !== "none" && tier !== "win") {
          setOverlayTier(tier);
          setOverlayPayout(winCredits * MOJOS_PER_CREDIT);
        } else if (result.totalPayout > 0) {
          setOverlayTier("win");
          setOverlayPayout(winCredits * MOJOS_PER_CREDIT);
        }
      } else {
        setCredits((c) => c - totalBet);
      }
    },
    [totalBet],
  );

  const onSpin = useCallback(() => {
    if (!canSpin) return;
    clearTimers();
    setOverlayTier("none");
    setLastResult(null);
    setSpinning(true);
    setStoppedReels(0);

    const result = spin(Number(lineBet));

    const tick = window.setInterval(() => {
      setGrid(
        Array.from({ length: REEL_COUNT }, () =>
          Array.from({ length: ROW_COUNT }, () => randomStripSymbol()),
        ),
      );
    }, 80);
    timersRef.current.push(tick);

    REEL_STOP_MS.forEach((delay, reelIndex) => {
      const t = window.setTimeout(() => {
        setStoppedReels(reelIndex + 1);
        setGrid((prev) => {
          const next = prev.map((col) => [...col]) as Grid;
          for (let row = 0; row < ROW_COUNT; row++) {
            next[reelIndex]![row] = result.grid[reelIndex]![row]!;
          }
          return next;
        });
        if (reelIndex === REEL_COUNT - 1) {
          window.clearInterval(tick);
          finishSpin(result);
        }
      }, delay);
      timersRef.current.push(t);
    });
  }, [canSpin, clearTimers, finishSpin, lineBet]);

  const displayGrid = grid;

  return (
    <div className="slot-page">
      <header className="slot-header">
        <div>
          <h1 className="slot-title">Spirit Slots</h1>
          <p className="slot-tagline">DAT Spirit Poker · neon reels · chase the Lucky 7</p>
        </div>
        <div className="slot-credits">
          <span className="slot-credits-label">Credits</span>
          <strong>{formatDatMojos((credits * MOJOS_PER_CREDIT).toString(), ticker)}</strong>
        </div>
      </header>

      <div className={`slot-cabinet${spinning ? " spinning" : ""}${overlayTier !== "none" ? " celebrate" : ""}`}>
        <div className="slot-marquee">
          <span className="slot-marquee-glow">★ DAT SPIRIT SLOTS ★</span>
        </div>

        <div className="slot-window">
          <div className="slot-reels">
            {Array.from({ length: REEL_COUNT }).map((_, reel) => (
              <div
                key={reel}
                className={`slot-reel${reel >= stoppedReels && spinning ? " active" : ""}`}
              >
                {Array.from({ length: ROW_COUNT }).map((_, row) => (
                  <SymbolCell
                    key={row}
                    symbolId={displayGrid[reel]![row]!}
                    highlighted={highlights.has(`${reel}-${row}`)}
                    spinning={spinning && reel >= stoppedReels}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="slot-payline-hint">{PAYLINES.length} paylines · Wild substitutes · 3+ Scatters pay anywhere</div>
        </div>

        {lastResult && !spinning && lastResult.totalPayout > 0 && overlayTier === "none" && (
          <p className="slot-last-win">
            Last win:{" "}
            <strong>
              {formatDatMojos((BigInt(lastResult.totalPayout) * MOJOS_PER_CREDIT).toString(), ticker)}
            </strong>
            {lastResult.scatterCount >= 3 && (
              <span className="slot-scatter-note"> · {lastResult.scatterCount} scatters!</span>
            )}
          </p>
        )}

        <div className="slot-controls">
          <label className="slot-bet-control">
            Line bet
            <select
              value={String(lineBet)}
              disabled={spinning}
              onChange={(e) => setLineBet(BigInt(e.target.value))}
            >
              {[1n, 2n, 5n, 10n, 20n, 50n].map((b) => (
                <option key={String(b)} value={String(b)}>
                  {formatDatMojos((b * MOJOS_PER_CREDIT).toString(), ticker)} / line
                </option>
              ))}
            </select>
          </label>
          <p className="slot-total-bet">
            Total bet: <strong>{formatDatMojos(totalBetMojos.toString(), ticker)}</strong>
          </p>
          <button type="button" className="slot-spin-btn" disabled={!canSpin} onClick={onSpin}>
            {spinning ? "Spinning…" : "SPIN"}
          </button>
          <button
            type="button"
            className="slot-secondary-btn"
            disabled={spinning}
            onClick={() => setCredits(STARTING_CREDITS)}
          >
            Refill demo credits
          </button>
          {import.meta.env.DEV && (
            <button
              type="button"
              className="slot-secondary-btn"
              disabled={spinning || overlayTier !== "none"}
              onClick={() => {
                setOverlayTier("mega");
                setOverlayPayout(2500n * MOJOS_PER_CREDIT);
              }}
            >
              Preview big win FX
            </button>
          )}
        </div>
      </div>

      <section className="slot-paytable panel">
        <h2>Paytable (per line bet)</h2>
        <ul className="slot-paytable-list">
          <li>
            <span>7️⃣ Lucky 7</span> <span>×25 · ×100 · ×500</span>
          </li>
          <li>
            <span>🂮 King</span> <span>×12 · ×35 · ×75</span>
          </li>
          <li>
            <span>🂡 Ace</span> <span>×10 · ×30 · ×60</span>
          </li>
          <li>
            <span>💎 Scatter (anywhere)</span> <span>3=×5 · 4=×20 · 5=×100</span>
          </li>
        </ul>
        <p className="muted small">Demo mode — credits are local only, not wired to Sage yet.</p>
      </section>

      {overlayTier !== "none" && (
        <WinOverlay
          tier={overlayTier}
          payoutMojos={overlayPayout}
          ticker={ticker}
          onDone={() => setOverlayTier("none")}
        />
      )}
    </div>
  );
}
