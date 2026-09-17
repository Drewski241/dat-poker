import {
  yourTurnCueSide,
  yourTurnCueTagline,
  type YourTurnCue,
} from "../your-turn-cue.js";
import { YourTurnCueArt } from "./your-turn/YourTurnCueArt.js";
import { YourTurnSign } from "./your-turn/YourTurnSign.js";

export function YourTurnReminder({
  cue,
  secondsLeft,
}: {
  cue: YourTurnCue;
  secondsLeft?: number;
}) {
  const side = yourTurnCueSide(cue);
  return (
    <aside
      className={`your-turn-cue your-turn-cue--${side} your-turn-cue--${cue}`}
      role="status"
      aria-live="assertive"
    >
      <div className="your-turn-cue-art">
        <YourTurnCueArt cue={cue} />
        <YourTurnSign tagline={yourTurnCueTagline(cue)} secondsLeft={secondsLeft} />
      </div>
    </aside>
  );
}
