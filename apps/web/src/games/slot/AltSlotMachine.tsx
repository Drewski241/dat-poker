import { useCallback, useEffect, useRef, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { SlotGameId } from "@dat-poker/shared";
import { SLOT_GAMES } from "@dat-poker/shared";
import { PAYLINE_COUNT } from "@dat-poker/slot-engine";
import { usePlaySession } from "../../play/PlaySessionContext.js";
import { api } from "../../api.js";
import { paylineDisplayName, SlotPaylineOverlay } from "./SlotPaylineOverlay.js";
import { symbolDisplay } from "./symbol-display.js";
import type { SlotSpinApiResult } from "./slot-api-types.js";
import { SlotGamePaytableModal } from "./SlotGamePaytableModal.js";
import { SlotWinCelebration } from "./SlotWinCelebration.js";
import {
  pickCelebrationVariant,
  resolveWinTier,
  shouldShowCelebration,
  type WinTier,
} from "./win-celebration.js";
import "./slot.css";

const REEL_COUNT = 5;
const ROW_COUNT = 3;
const REEL_STOP_MS = [900, 1150, 1400, 1650, 1900];
const DEFAULT_BET_OPTIONS = ["1000", "2000", "5000", "10000", "20000"];

function buildResultText(
  gameId: SlotGameId,
  response: SlotSpinApiResult,
  ticker: string,
  extra?: string,
): string {
  const wins = response.result.lineWins ?? [];
  const ways = response.result.waysWins ?? [];
  const parts: string[] = [];
  for (const w of wins) {
    const sym = symbolDisplay(gameId, w.symbol);
    parts.push(`${paylineDisplayName(w.lineIndex)}: ${sym.label} ×${w.count} (${w.multiplier}×)`);
  }
  for (const w of ways) {
    const sym = symbolDisplay(gameId, w.symbol);
    parts.push(`${sym.label} ${w.reelCount}-reel · ${w.ways} ways (${w.multiplier}×)`);
  }
  if (response.result.scatterCount >= 3 && response.result.scatterMultiplier > 0) {
    parts.push(`Scatter ×${response.result.scatterCount}`);
  }
  if (response.wonProgressive) parts.push("Progressive jackpot!");
  const meta = response.result.meta ?? {};
  if (gameId === "mine-mojo" && meta.cascadeSteps) {
    parts.unshift(`${meta.cascadeSteps} cascade${meta.cascadeSteps === 1 ? "" : "s"}`);
  }
  if (gameId === "spirit-stampede" && meta.expandingWild) {
    parts.unshift("Expanding wild respin");
  }
  if (response.freeSpin) parts.unshift("Boss free spin");
  const gross =
    BigInt(response.lineWinMojos ?? "0") + BigInt(response.progressiveWinMojos ?? "0");
  if (parts.length === 0) {
    return "No win this spin.";
  }
  const net = BigInt(response.netMojos);
  const netLabel =
    net >= 0n ? `Net +${formatDatMojos(net.toString(), ticker)}` : `Net ${formatDatMojos(net.toString(), ticker)}`;
  return `${parts.join(" · ")} — Won ${formatDatMojos(gross.toString(), ticker)} · ${netLabel}${extra ? ` · ${extra}` : ""}`;
}

export function AltSlotMachine({
  gameId,
  ticker = "DAT",
  playerId,
}: {
  gameId: Exclude<SlotGameId, "spirit">;
  ticker?: string;
  playerId: string;
}) {
  const meta = SLOT_GAMES[gameId];
  const { session, refreshSession } = usePlaySession();
  const betOptions = session?.betOptionsMojos ?? DEFAULT_BET_OPTIONS;
  const [selectedBetMojos, setSelectedBetMojos] = useState(
    session?.defaultBetMojos ?? betOptions[0] ?? "1000",
  );
  const [jackpotMojos, setJackpotMojos] = useState("100000");
  const [bossHp, setBossHp] = useState(100);
  const [freeSpins, setFreeSpins] = useState(0);
  const [holdDrawActive, setHoldDrawActive] = useState(false);
  const [heldReels, setHeldReels] = useState<Set<number>>(() => new Set());
  const [grid, setGrid] = useState<string[][]>(() =>
    Array.from({ length: REEL_COUNT }, () => Array.from({ length: ROW_COUNT }, () => "?")),
  );
  const [spinning, setSpinning] = useState(false);
  const [stoppedReels, setStoppedReels] = useState(REEL_COUNT);
  const [spinResult, setSpinResult] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Set<string>>(() => new Set());
  const [winningLineIndices, setWinningLineIndices] = useState<ReadonlySet<number>>(() => new Set());
  const [showPaylines, setShowPaylines] = useState(gameId !== "spirit-stampede");
  const [paytableOpen, setPaytableOpen] = useState(false);
  const [celebration, setCelebration] = useState<{
    tier: WinTier;
    variant: number;
    payoutMojos: bigint;
  } | null>(null);
  const timersRef = useRef<number[]>([]);
  const stoppedReelsRef = useRef(0);

  const balanceMojos = BigInt(session?.accountBalanceMojos ?? session?.stackMojos ?? "0");
  const betMojos = BigInt(selectedBetMojos);
  const canSpin =
    Boolean(playerId && session?.active) &&
    !spinning &&
    !session?.handInProgress &&
    !holdDrawActive &&
    (balanceMojos >= betMojos || (gameId === "house-edge" && freeSpins > 0));

  useEffect(() => {
    void api.getSlotJackpot(gameId).then((j) => setJackpotMojos(j.progressiveJackpotMojos));
  }, [gameId]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const applySpinResult = useCallback(
    (response: SlotSpinApiResult, resultGrid: string[][]) => {
      const winCells = new Set<string>();
      const winLines = new Set<number>();
      for (const w of response.result.lineWins ?? []) {
        winLines.add(w.lineIndex);
        for (const c of w.cells) winCells.add(`${c.reel}-${c.row}`);
      }
      setHighlights(winCells);
      setWinningLineIndices(winLines);
      setJackpotMojos(response.progressiveJackpotMojos);
      setSpinResult(buildResultText(gameId, response, ticker));
      const m = response.result.meta;
      if (gameId === "house-edge" && m) {
        if (typeof m.bossHp === "number") setBossHp(m.bossHp);
        if (typeof m.freeSpinsRemaining === "number") setFreeSpins(m.freeSpinsRemaining);
      }
      if (gameId === "poker-hands" && response.holdDrawOffer) {
        setHoldDrawActive(true);
        setHeldReels(new Set());
        setSpinResult((prev) => `${prev ?? ""} · Hold up to 2 reels, then Draw (free)`);
      }
      setGrid(resultGrid.map((col) => [...col]));

      const grossWin =
        BigInt(response.lineWinMojos ?? "0") + BigInt(response.progressiveWinMojos ?? "0");
      const spinBet = BigInt(response.betMojos ?? selectedBetMojos);
      const tier = resolveWinTier(
        grossWin,
        spinBet,
        response.wonProgressive,
        response.result.winTier,
      );
      if (shouldShowCelebration(tier)) {
        setCelebration({
          tier,
          variant: pickCelebrationVariant(gameId, tier),
          payoutMojos: grossWin,
        });
      } else {
        setCelebration(null);
      }
    },
    [gameId, selectedBetMojos, ticker],
  );

  const animateToGrid = useCallback(
    (resultGrid: string[][], onDone: () => void) => {
      clearTimers();
      setSpinning(true);
      setStoppedReels(0);
      stoppedReelsRef.current = 0;
      const tick = window.setInterval(() => {
        const locked = stoppedReelsRef.current;
        if (locked >= REEL_COUNT) return;
        setGrid((prev) =>
          prev.map((col, reelIndex) => {
            if (reelIndex < locked) return col;
            return Array.from({ length: ROW_COUNT }, () => "?");
          }),
        );
      }, 80);
      timersRef.current.push(tick);
      REEL_STOP_MS.forEach((delay, reelIndex) => {
        const t = window.setTimeout(() => {
          stoppedReelsRef.current = reelIndex + 1;
          setStoppedReels(reelIndex + 1);
          setGrid((prev) => {
            const next = prev.map((c) => [...c]);
            for (let row = 0; row < ROW_COUNT; row++) {
              next[reelIndex]![row] = resultGrid[reelIndex]![row]!;
            }
            return next;
          });
          if (reelIndex === REEL_COUNT - 1) {
            window.clearInterval(tick);
            stoppedReelsRef.current = REEL_COUNT;
            setGrid(resultGrid.map((c) => [...c]));
            setSpinning(false);
            onDone();
          }
        }, delay);
        timersRef.current.push(t);
      });
    },
    [clearTimers],
  );

  const onSpin = useCallback(async () => {
    if (!canSpin) return;
    setHoldDrawActive(false);
    setCelebration(null);
    setSpinResult(null);
    setHighlights(new Set());
    setWinningLineIndices(new Set());
    try {
      const response = await api.spinSlotGame(gameId, playerId, selectedBetMojos);
      animateToGrid(response.result.grid, () => {
        void refreshSession(playerId);
        applySpinResult(response, response.result.grid);
      });
    } catch (e) {
      setSpinning(false);
      setSpinResult((e as Error).message);
    }
  }, [animateToGrid, applySpinResult, canSpin, gameId, playerId, refreshSession, selectedBetMojos]);

  const onDraw = useCallback(async () => {
    if (!holdDrawActive) return;
    setSpinning(true);
    try {
      const response = await api.pokerHandsDraw(playerId, [...heldReels]);
      setHoldDrawActive(false);
      animateToGrid(response.result.grid, () => {
        void refreshSession(playerId);
        applySpinResult(response as SlotSpinApiResult, response.result.grid);
      });
    } catch (e) {
      setSpinning(false);
      setSpinResult((e as Error).message);
    }
  }, [animateToGrid, applySpinResult, heldReels, holdDrawActive, playerId, refreshSession]);

  const toggleHold = (reel: number) => {
    if (!holdDrawActive || spinning) return;
    setHeldReels((prev) => {
      const next = new Set(prev);
      if (next.has(reel)) next.delete(reel);
      else if (next.size < 2) next.add(reel);
      return next;
    });
  };

  return (
    <div className="slot-page">
      <header className="slot-header">
        <div>
          <h1 className="slot-title">
            {meta.emoji} {meta.title}
          </h1>
          <p className="slot-tagline">
            {meta.tagline} · {meta.progressiveHint} ·{" "}
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

      {gameId === "house-edge" && (
        <div className="slot-boss panel">
          <h2>Dealer boss</h2>
          <div className="slot-boss-bar" aria-hidden>
            <div className="slot-boss-fill" style={{ width: `${bossHp}%` }} />
          </div>
          <p className="muted small">
            HP {bossHp}/100 · drain the bar for 5 free boss spins (2× pays)
            {freeSpins > 0 ? ` · ${freeSpins} free spins left` : ""}
          </p>
        </div>
      )}

      <div className="slot-progressive panel">
        <h2>{meta.title} progressive</h2>
        <p className="slot-jackpot-amount">{formatDatMojos(jackpotMojos, ticker)}</p>
        <p className="muted small">Separate pot · 5% of each paid spin</p>
      </div>

      <div className="slot-spin-result-slot">
        <div className={`banner slot-spin-result${spinning ? " pending" : spinResult ? " ok" : " idle"}`}>
          {spinning ? "Spinning…" : spinResult ?? "Results appear here after each spin."}
        </div>
      </div>

      <div className={`slot-cabinet${spinning ? " spinning" : ""}${celebration ? " celebrate" : ""}`}>
        <div className="slot-marquee">
          <span className="slot-marquee-glow">
            ★ {meta.title.toUpperCase()} ★
          </span>
        </div>
        <div className="slot-window">
          {showPaylines && (
            <label className="slot-payline-toggle">
              <input type="checkbox" checked={showPaylines} onChange={(e) => setShowPaylines(e.target.checked)} />
              Show paylines
            </label>
          )}
          <div className="slot-reels-wrap">
            <div className="slot-reels">
              {Array.from({ length: REEL_COUNT }).map((_, reel) => (
                <div
                  key={reel}
                  className={`slot-reel${reel >= stoppedReels && spinning ? " active" : ""}${holdDrawActive && heldReels.has(reel) ? " held" : ""}`}
                  onClick={() => toggleHold(reel)}
                  role={holdDrawActive ? "button" : undefined}
                >
                  {Array.from({ length: ROW_COUNT }).map((_, row) => {
                    const id = grid[reel]![row]!;
                    const sym = symbolDisplay(gameId, id);
                    return (
                      <div
                        key={row}
                        className={`slot-cell sym-${id}${gameId === "poker-hands" ? " slot-cell-poker" : ""}${gameId === "poker-hands" && sym.pokerRed ? " poker-red" : ""}${gameId === "poker-hands" && sym.pokerRed === false ? " poker-black" : ""}${highlights.has(`${reel}-${row}`) ? " win" : ""}${spinning && reel >= stoppedReels ? " blur" : ""}`}
                      >
                        {gameId === "poker-hands" && sym.pokerRank ? (
                          <>
                            <span className="slot-poker-rank">{sym.pokerRank}</span>
                            <span className="slot-emoji slot-poker-suit">{sym.emoji}</span>
                          </>
                        ) : (
                          <>
                            <span className="slot-emoji">{sym.emoji}</span>
                            <span className="slot-sym-label">{sym.label}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {showPaylines && (
              <SlotPaylineOverlay showLines={showPaylines && !spinning} winningLineIndices={winningLineIndices} />
            )}
          </div>
        </div>
        <div className="slot-controls">
          {gameId !== "spirit-stampede" && (
            <p className="slot-payline-legend">
              {formatDatMojos(selectedBetMojos, ticker)} wager · {PAYLINE_COUNT} lines
            </p>
          )}
          {gameId === "spirit-stampede" && (
            <p className="slot-payline-legend">243 ways · left-to-right · expanding wild on reel 3</p>
          )}
          <div className="slot-bet-options">
            {betOptions.map((mojos) => (
              <button
                key={mojos}
                type="button"
                className={`slot-bet-chip${mojos === selectedBetMojos ? " active" : ""}`}
                disabled={spinning || holdDrawActive}
                onClick={() => setSelectedBetMojos(mojos)}
              >
                {formatDatMojos(mojos, ticker)}
              </button>
            ))}
          </div>
          {holdDrawActive ? (
            <div className="slot-hold-actions">
              <button type="button" className="slot-spin-btn" disabled={spinning} onClick={() => void onDraw()}>
                Draw
              </button>
              <button
                type="button"
                className="slot-bet-chip"
                disabled={spinning}
                onClick={() => {
                  void api.skipPokerDraw(playerId).then(() => setHoldDrawActive(false));
                }}
              >
                Skip
              </button>
            </div>
          ) : (
            <button type="button" className="slot-spin-btn" disabled={!canSpin} onClick={() => void onSpin()}>
              {spinning ? "Spinning…" : freeSpins > 0 && gameId === "house-edge" ? "Free spin" : "SPIN"}
            </button>
          )}
        </div>
      </div>

      {celebration && (
        <SlotWinCelebration
          gameId={gameId}
          tier={celebration.tier}
          variant={celebration.variant}
          payoutMojos={celebration.payoutMojos}
          ticker={ticker}
          onDone={() => setCelebration(null)}
        />
      )}

      <SlotGamePaytableModal
        gameId={gameId}
        open={paytableOpen}
        onClose={() => setPaytableOpen(false)}
        totalBetMojos={betMojos}
        ticker={ticker}
        progressiveJackpotMojos={jackpotMojos}
      />
    </div>
  );
}
