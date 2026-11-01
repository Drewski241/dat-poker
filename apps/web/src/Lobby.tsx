import { formatDatMojos } from "@dat-poker/shared";
import type { SlotsSessionInfo } from "./api.js";
import type { PlayerPose } from "./slots/PlayerCharacter.js";

export function Lobby({
  session,
  onPose,
  onSlots,
  onPoker,
  onLogout,
}: {
  session: SlotsSessionInfo;
  onPose: (pose: PlayerPose) => void;
  onSlots: () => void;
  onPoker: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      <header>
        <h1>Pick a game</h1>
        <p className="tagline">Signed in as {session.displayName}</p>
      </header>

      <p className="bankroll">
        Demo bankroll: <strong>{formatDatMojos(session.bankrollMojos, "DAT")}</strong>
      </p>
      <p className="muted small">DAT Slots uses this demo bankroll. DAT Poker still uses Sage for buy-in.</p>

      <div className="game-grid">
        <button
          id="play-slots"
          type="button"
          className="game-card"
          onPointerDown={() => onPose("reaching")}
          onPointerUp={() => onPose("seated")}
          onClick={onSlots}
        >
          <span className="game-card-kicker">Slots</span>
          <strong>DAT Slots</strong>
          <span>Press Spin. Match three on a line.</span>
        </button>
        <button
          type="button"
          className="game-card game-card-quiet"
          onPointerDown={() => onPose("reaching")}
          onPointerUp={() => onPose("seated")}
          onClick={onPoker}
        >
          <span className="game-card-kicker">Poker</span>
          <strong>DAT Poker</strong>
          <span>No-limit hold&apos;em versus the house.</span>
        </button>
      </div>

      <div className="row">
        <button type="button" className="secondary" onClick={onLogout}>
          Log out
        </button>
      </div>
    </>
  );
}
