import { useEffect, useRef, useState } from "react";
import type { CardFace } from "../api.js";
import { ChipStack } from "./ChipStack.js";
import { PlayingCard } from "./PlayingCard.js";

export interface FeltSeat {
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
}

const TURN_SECONDS = 45;

export function FeltTable({
  house,
  hero,
  board,
  street,
  potMojos,
  potAward,
  commitHash,
  locking,
  houseNote,
  secondsLeft,
  ticker,
  banner,
}: {
  house: FeltSeat;
  hero: FeltSeat;
  board: CardFace[];
  street: string | null;
  potMojos: string;
  potAward: "you" | "house" | null;
  commitHash: string | null;
  locking: boolean;
  houseNote: string | null;
  secondsLeft: number | null;
  ticker?: string;
  banner: string | null;
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

  const shortHash = commitHash
    ? `${commitHash.slice(0, 8)}…${commitHash.slice(-4)}`
    : null;

  return (
    <section className="felt-shell" aria-label="Poker table">
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

      <Seat seat={house} ticker={ticker} note={houseNote} />

      <div className="felt-middle">
        {shortHash && (
          <p className="deck-lock">Deck locked · {shortHash}</p>
        )}
        <div className="board-cards">
          {board.map((card, index) => (
            <PlayingCard
              key={`${card.rank}${card.suit}${index}`}
              card={card}
              delayMs={index * 160}
            />
          ))}
          {board.length === 0 && !banner && (
            <p className="felt-wait">{locking ? "Shuffling the deck…" : street ? street : "Take a seat"}</p>
          )}
        </div>
        {street && board.length > 0 && <p className="street-label">{street}</p>}
        {BigInt(potMojos || "0") > 0n && (
          <div key={`${potAward ?? "live"}-${potMojos}`} className={`pot ${potAward ? `pot-award ${potAward}` : ""}`}>
            <ChipStack mojos={potMojos} ticker={ticker} />
          </div>
        )}
      </div>

      <Seat
        seat={hero}
        ticker={ticker}
        secondsLeft={secondsLeft}
        turnSeconds={TURN_SECONDS}
      />

      {banner && <div className="banner win felt-banner">{banner}</div>}
    </section>
  );
}

function Seat({
  seat,
  ticker,
  note,
  secondsLeft,
  turnSeconds,
}: {
  seat: FeltSeat;
  ticker?: string;
  note?: string | null;
  secondsLeft?: number | null;
  turnSeconds?: number;
}) {
  const showBacks = seat.faceDown && !seat.folded;
  return (
    <div className={`seat ${seat.acting ? "acting" : ""} ${seat.folded ? "folded" : ""}`}>
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
      <div className="hole-cards">
        {showBacks && (
          <>
            <PlayingCard faceDown delayMs={0} />
            <PlayingCard faceDown delayMs={120} />
          </>
        )}
        {!seat.faceDown &&
          seat.holeCards.map((card, index) => (
            <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} delayMs={index * 120} />
          ))}
      </div>
      {seat.handLabel && <p className="hand-label">{seat.handLabel}</p>}
      {note && <p className="house-note">{note}</p>}
      <ChipStack mojos={seat.stackMojos} ticker={ticker} />
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
