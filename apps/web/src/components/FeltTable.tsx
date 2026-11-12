import { useEffect, useRef, useState } from "react";
import type { CardFace } from "../api.js";
import { ChipStack } from "./ChipStack.js";
import { PlayingCard } from "./PlayingCard.js";

export interface FeltSeat {
  seatIndex: number;
  name: string;
  stackMojos: string;
  betMojos: string;
  holeCards: CardFace[];
  faceDown: boolean;
  folded: boolean;
  isDealer: boolean;
  acting: boolean;
  allIn: boolean;
  handLabel: string | null;
  isHero: boolean;
  empty: boolean;
  eliminated: boolean;
  holeCount: number;
}

const TURN_SECONDS = 45;
const MAX_SEATS = 6;

/** Clockwise from the hero, who is drawn at the bottom. */
const SPOTS = [
  { left: "50%", top: "84%" },
  { left: "84%", top: "64%" },
  { left: "84%", top: "32%" },
  { left: "50%", top: "14%" },
  { left: "16%", top: "32%" },
  { left: "16%", top: "64%" },
];

export function FeltTable({
  seats,
  heroSeat,
  board,
  street,
  potMojos,
  commitHash,
  locking,
  houseNote,
  secondsLeft,
  ticker,
  banner,
  onEmptySeat,
}: {
  seats: FeltSeat[];
  heroSeat: number;
  board: CardFace[];
  street: string | null;
  potMojos: string;
  commitHash: string | null;
  locking: boolean;
  houseNote: string | null;
  secondsLeft: number | null;
  ticker?: string;
  banner: string | null;
  onEmptySeat?: (seatIndex: number) => void;
}) {
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(false);
  const boardLen = useRef(board.length);
  soundRef.current = soundOn;

  useEffect(() => {
    const enabled = window.sessionStorage.getItem("dat-poker-sound") === "on";
    setSoundOn(enabled);
    soundRef.current = enabled;
  }, []);

  useEffect(() => {
    if (board.length > boardLen.current) {
      play(soundRef.current, audioRef, 520, 0.05);
    }
    boardLen.current = board.length;
  }, [board.length]);

  useEffect(() => {
    if (banner) play(soundRef.current, audioRef, 660, 0.12);
  }, [banner]);

  const shortHash = commitHash ? `${commitHash.slice(0, 8)}…${commitHash.slice(-4)}` : null;
  const byIndex = new Map(seats.map((seat) => [seat.seatIndex, seat]));
  const openCount = MAX_SEATS - byIndex.size;

  return (
    <div className="felt-wrap">
      <section className="felt-shell" aria-label="Six-max poker table">
        <div className="felt-tools">
          <button
            type="button"
            className="sound-toggle"
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              window.sessionStorage.setItem("dat-poker-sound", next ? "on" : "off");
              if (next) play(true, audioRef, 440, 0.06);
            }}
          >
            Sound {soundOn ? "on" : "off"}
          </button>
        </div>

        <div className="felt-center">
          {shortHash && <p className="deck-lock">Deck locked · {shortHash}</p>}
          <div className="board-cards">
            {board.map((card, index) => (
              <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} delayMs={index * 140} />
            ))}
            {board.length === 0 && !banner && (
              <p className="felt-wait">
                {locking ? "Shuffling the deck…" : street ? street : openCount > 0 ? "Open seats" : "Deal when ready"}
              </p>
            )}
          </div>
          {street && board.length > 0 && <p className="street-label">{street}</p>}
          {BigInt(potMojos || "0") > 0n && (
            <div className="pot">
              <ChipStack mojos={potMojos} ticker={ticker} />
            </div>
          )}
        </div>

        {Array.from({ length: MAX_SEATS }, (_, seatIndex) => {
          const spot = (seatIndex - heroSeat + MAX_SEATS) % MAX_SEATS;
          const seat = byIndex.get(seatIndex);
          return (
            <div key={seatIndex} className="seat-slot" style={SPOTS[spot]}>
              {seat && !seat.empty ? (
                <Seat
                  seat={seat}
                  ticker={ticker}
                  secondsLeft={seat.isHero ? secondsLeft : null}
                  turnSeconds={TURN_SECONDS}
                />
              ) : (
                <button
                  type="button"
                  className="seat-open"
                  onClick={() => onEmptySeat?.(seatIndex)}
                >
                  Seat {seatIndex + 1}
                </button>
              )}
            </div>
          );
        })}
      </section>
      {houseNote && <p className="house-note">{houseNote}</p>}
      {banner && <div className="banner win felt-banner">{banner}</div>}
    </div>
  );
}

function Seat({
  seat,
  ticker,
  secondsLeft,
  turnSeconds,
}: {
  seat: FeltSeat;
  ticker?: string;
  secondsLeft?: number | null;
  turnSeconds?: number;
}) {
  const showBacks = seat.faceDown && !seat.folded;
  return (
    <div
      className={`seat ${seat.isHero ? "hero" : "remote"} ${seat.acting ? "acting" : ""} ${seat.folded ? "folded" : ""} ${seat.eliminated ? "out" : ""}`}
    >
      <div className="seat-meta">
        {seat.isDealer && <span className="dealer-btn">D</span>}
        <span className="seat-name">{seat.name}</span>
        {seat.allIn && <span className="allin-tag">All-in</span>}
        {secondsLeft != null && turnSeconds != null && (
          <span className="clock" aria-label={`${secondsLeft} seconds left`}>
            <span style={{ width: `${Math.max(0, (secondsLeft / turnSeconds) * 100)}%` }} />
          </span>
        )}
      </div>
      <div className={`hole-cards ${seat.holeCount > 2 ? "omaha" : ""}`}>
        {showBacks &&
          Array.from({ length: seat.holeCount }, (_, index) => (
            <PlayingCard key={index} faceDown delayMs={index * 60} />
          ))}
        {!seat.faceDown &&
          seat.holeCards.map((card, index) => (
            <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} delayMs={index * 80} />
          ))}
      </div>
      {seat.handLabel && <p className="hand-label">{seat.handLabel}</p>}
      {seat.eliminated ? <p className="out-tag">Out</p> : <ChipStack mojos={seat.stackMojos} ticker={ticker} />}
      {BigInt(seat.betMojos || "0") > 0n && (
        <div className="seat-bet">
          <ChipStack mojos={seat.betMojos} ticker={ticker} />
        </div>
      )}
    </div>
  );
}

function play(
  enabled: boolean,
  audioRef: { current: AudioContext | null },
  freq: number,
  seconds: number,
) {
  if (!enabled || typeof window === "undefined") return;
  const AudioCtx = window.AudioContext;
  if (!AudioCtx) return;
  if (!audioRef.current) audioRef.current = new AudioCtx();
  const ctx = audioRef.current;
  if (ctx.state === "suspended") void ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
  osc.start(now);
  osc.stop(now + seconds);
}
