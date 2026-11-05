import type { DatTokenInfo, HandHistoryEntry } from "../api.js";
import { HandHistoryPanel } from "./HandHistoryPanel.js";

type Props = {
  open: boolean;
  onClose: () => void;
  datToken: DatTokenInfo | null;
  playerId: string;
  hands: HandHistoryEntry[];
  playerLabel: (id: string, youId: string | null, display?: string) => string;
  seatDisplayFor: (id: string) => string | undefined;
};

export function HandHistoryModal({
  open,
  onClose,
  datToken,
  playerId,
  hands,
  playerLabel,
  seatDisplayFor,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="hand-history-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="hand-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hand-history-modal-title"
      >
        <header className="hand-history-modal-header">
          <h2 id="hand-history-modal-title">Hand history</h2>
          <button type="button" className="secondary hand-history-modal-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="hand-history-modal-body">
          <HandHistoryPanel
            datToken={datToken}
            playerId={playerId}
            hands={hands}
            playerLabel={playerLabel}
            seatDisplayFor={seatDisplayFor}
          />
        </div>
      </div>
    </div>
  );
}
