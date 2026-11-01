import { useEffect, useRef, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import { api, type SlotsSessionInfo, type SlotsSpinResponse } from "../api.js";
import type { PlayerPose } from "./PlayerCharacter.js";
import { playBigWinFanfare, primeFanfare } from "./fanfare.js";

const SYMBOLS = ["cherry", "lemon", "bar", "bell", "clover", "seven", "dat"] as const;

const IDLE_GRID: string[][] = [
  ["cherry", "bell", "bar"],
  ["lemon", "dat", "seven"],
  ["bar", "clover", "cherry"],
];

function randomGrid(): string[][] {
  return [0, 1, 2].map(() => [0, 1, 2].map(() => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!));
}

function SymbolTile({ symbol, hot }: { symbol: string; hot: boolean }) {
  const label =
    symbol === "dat" ? "DAT" : symbol === "seven" ? "7" : symbol === "bar" ? "BAR" : symbol.slice(0, 1).toUpperCase() + symbol.slice(1);
  return (
    <div className={`symbol-tile symbol-${symbol}${hot ? " hot" : ""}`}>
      <span>{label}</span>
    </div>
  );
}

export function SlotsScreen({
  session,
  onSession,
  onPose,
  onLobby,
}: {
  session: SlotsSessionInfo;
  onSession: (next: SlotsSessionInfo) => void;
  onPose: (pose: PlayerPose) => void;
  onLobby: () => void;
}) {
  const [bet, setBet] = useState(session.defaultBetPerLineMojos);
  const [grid, setGrid] = useState(IDLE_GRID);
  const [last, setLast] = useState<SlotsSpinResponse | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spins, setSpins] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const reelLock = useRef(false);

  useEffect(() => {
    if (!spinning) return;
    reelLock.current = false;
    const id = window.setInterval(() => {
      if (!reelLock.current) setGrid(randomGrid());
    }, 80);
    return () => window.clearInterval(id);
  }, [spinning]);

  const totalBet = (BigInt(bet) * BigInt(session.lines)).toString();
  const hot = new Set<string>();
  if (last && !spinning) {
    for (const win of last.wins) {
      for (const cell of win.cells) hot.add(`${cell.row}:${cell.col}`);
    }
  }

  const resultText = (() => {
    if (spinning) return "Reels spinning…";
    if (!last) return "Press Spin.";
    if (last.bigWin) return `Big win ${formatDatMojos(last.payoutMojos, "DAT")}`;
    if (BigInt(last.payoutMojos) === 0n) return "No line this spin.";
    return `Win ${formatDatMojos(last.payoutMojos, "DAT")}`;
  })();

  const spin = async () => {
    if (lock.current) return;
    lock.current = true;
    setSpinning(true);
    setError(null);
    onPose("reaching");
    const started = performance.now();
    try {
      const result = await api.slotsSpin(session.playerId, bet);
      const remaining = 720 - (performance.now() - started);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      reelLock.current = true;
      setGrid(result.grid);
      setLast(result);
      setSpins((count) => count + 1);
      onSession({ ...session, bankrollMojos: result.bankrollMojos });
      if (result.bigWin) {
        onPose("celebrate");
        playBigWinFanfare();
      } else {
        onPose("seated");
      }
    } catch (err) {
      setError((err as Error).message);
      onPose("seated");
    } finally {
      lock.current = false;
      setSpinning(false);
    }
  };

  return (
    <>
      <header>
        <h1>DAT Slots</h1>
        <p className="tagline">Match three symbols on a line. Big win pays at least 8× the total bet.</p>
      </header>

      <div className="row">
        <button type="button" className="secondary" onClick={onLobby} disabled={spinning}>
          Lobby
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <section className={`slots-cabinet${last?.bigWin && !spinning ? " big-win" : ""}`}>
        <div className="slots-top">
          <p>
            Demo bankroll <strong>{formatDatMojos(session.bankrollMojos, "DAT")}</strong>
          </p>
          <p className="muted">Spins {spins}</p>
        </div>

        <p className={`spin-result${last?.bigWin && !spinning ? " big" : ""}`} aria-live="polite">
          {resultText}
        </p>

        <div className={`reels${spinning ? " spinning" : ""}`} aria-label="Slot reels">
          {grid.map((row, rowIndex) => (
            <div className="reel-row" key={rowIndex}>
              {row.map((symbol, colIndex) => (
                <SymbolTile
                  key={`${rowIndex}-${colIndex}`}
                  symbol={symbol}
                  hot={hot.has(`${rowIndex}:${colIndex}`)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="bet-choices" role="group" aria-label="Bet per line">
          {session.betOptionsMojos.map((option) => (
            <button
              key={option}
              type="button"
              className={option === bet ? "bet-choice selected" : "bet-choice"}
              disabled={spinning}
              onClick={() => setBet(option)}
            >
              {formatDatMojos(option, "DAT")} / line
            </button>
          ))}
        </div>
        <p className="muted small">Total bet {formatDatMojos(totalBet, "DAT")} across {session.lines} lines.</p>

        <button
          id="spin-button"
          type="button"
          className="spin-button"
          disabled={spinning}
          onPointerDown={() => {
            primeFanfare();
            onPose("reaching");
          }}
          onClick={() => void spin()}
        >
          {spinning ? "Spinning…" : "Spin"}
        </button>
      </section>

      <section className="panel">
        <h2>Paytable</h2>
        <ul className="paytable">
          {session.paytable.map((row) => (
            <li key={row.symbol}>
              <span>{row.label}</span>
              <span>{row.multiplier}× line</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Demo bankroll only. It is not a Sage balance and cannot be withdrawn.
        </p>
      </section>
    </>
  );
}
