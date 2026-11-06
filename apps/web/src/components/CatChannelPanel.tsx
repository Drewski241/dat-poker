import type { CatChannelSnapshot, PuzzleCondition } from "../api.js";
import { formatDatMojos } from "@dat-poker/shared";

export function CatChannelPanel(props: {
  ticker?: string;
  busy: boolean;
  apiOk: boolean | null;
  channel: CatChannelSnapshot | null;
  proof: { kind: string; conditions: PuzzleCondition[] } | null;
  onPlay: () => void;
  onSign: () => void;
  onProve: (kind: "close" | "settle" | "preempt") => void;
  onClose: () => void;
}) {
  const { channel, ticker } = props;
  return (
    <section className="panel">
      <h2>Heads-up DAT channel</h2>
      <p className="muted small">
        Two-player pot inside a DAT CAT. You and the house each sign every new balance. Either side can
        force the latest signed balance on-chain after the timeout.
      </p>
      {!channel ? (
        <button type="button" disabled={props.busy || !props.apiOk} onClick={props.onPlay}>
          Play heads-up DAT channel
        </button>
      ) : (
        <>
          <p>
            Sequence <strong>{channel.sequence}</strong> · {channel.signed ? "both signatures in" : "waiting for your signature"} ·{" "}
            {channel.fullSigHolder === "alice" ? "you hold the full signature" : "house holds the full signature"}
          </p>
          <p>
            You {formatDatMojos(channel.aliceAmount, ticker)} · House {formatDatMojos(channel.bobAmount, ticker)} · locked{" "}
            {formatDatMojos(channel.lockedMojos, ticker)}
          </p>
          {channel.desyncReason && <p className="banner error">{channel.desyncReason}</p>}
          <p className="hash">Fund this CAT puzzle hash from Sage: {channel.catPuzzleHashHex}</p>
          {channel.coinIdSimulated && (
            <p className="muted small">
              Coin id is simulated until a real parent coin funds that puzzle. Timeout {channel.timeoutBlocks} blocks.
              XCH still pays the fee.
            </p>
          )}
          {!channel.signed && (
            <button type="button" disabled={props.busy} onClick={props.onSign}>
              Sign current balance
            </button>
          )}
          <div className="row">
            <button type="button" className="secondary" disabled={props.busy} onClick={() => props.onProve("close")}>
              Prove cooperative close
            </button>
            <button type="button" className="secondary" disabled={props.busy} onClick={() => props.onProve("settle")}>
              Prove timeout settle
            </button>
            <button type="button" className="secondary" disabled={props.busy} onClick={() => props.onProve("preempt")}>
              Prove preempt
            </button>
            <button type="button" disabled={props.busy || !channel.signed} onClick={props.onClose}>
              Sign cooperative close
            </button>
          </div>
          {channel.closeReady && <p className="ok-text">Both close signatures are ready.</p>}
          {props.proof && (
            <ul className="players">
              {props.proof.conditions.map((condition, index) => (
                <li key={`${condition.opcode}-${index}`}>
                  {conditionLabel(condition)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function conditionLabel(condition: PuzzleCondition): string {
  if (condition.opcode === 51) {
    return `Pay ${condition.amount} mojos to inner puzzle ${condition.puzzleHash?.slice(0, 16)}…`;
  }
  if (condition.opcode === 73) return `Assert coin amount ${condition.value}`;
  if (condition.opcode === 82) return `Wait ${condition.value} blocks`;
  if (condition.opcode === 50) return "Require both live close signatures (AGG_SIG_ME)";
  if (condition.opcode === 49) return "Require the co-signed balance (AGG_SIG_UNSAFE)";
  return `Condition ${condition.opcode}`;
}
