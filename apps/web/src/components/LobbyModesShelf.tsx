export type LobbyModeAction =
  | "nlhe"
  | "plo4"
  | "plo4_hl"
  | "pineapple"
  | "crazy_pineapple"
  | "lazy_pineapple"
  | "five_card_draw"
  | "triple_draw_27"
  | "badugi"
  | "seven_card_stud"
  | "razz"
  | "sng"
  | "sng_plo8"
  | "mtt16"
  | "mtt_plo16"
  | "mtt"
  | "mtt_plo500";

type Props = {
  disabled: boolean;
  mttLabel: string;
  moreOpen: boolean;
  onToggleMore: () => void;
  onAction: (action: LobbyModeAction) => void;
};

/**
 * Lobby game picker: Hold'em hero, tournaments, Omaha, then collapsible "More games".
 */
export function LobbyModesShelf({
  disabled,
  mttLabel,
  moreOpen,
  onToggleMore,
  onAction,
}: Props) {
  return (
    <div className="lobby-modes">
      <div className="lobby-mode-hero">
        <p className="lobby-mode-kicker">Play now</p>
        <button
          type="button"
          className="lobby-mode-hero-btn"
          disabled={disabled}
          onClick={() => onAction("nlhe")}
        >
          Hold&apos;em · 6-max cash
        </button>
        <p className="muted small lobby-mode-hero-note">
          Fast seat with house fill. Best place to start.
        </p>
      </div>

      <div className="lobby-mode-group">
        <h3 className="lobby-mode-heading">Hold&apos;em tournaments</h3>
        <div className="lobby-mode-row">
          <button type="button" className="secondary" disabled={disabled} onClick={() => onAction("sng")}>
            9-max SNG
          </button>
          <button type="button" className="secondary" disabled={disabled} onClick={() => onAction("mtt16")}>
            16-player SNG
          </button>
          <button
            type="button"
            className="secondary lobby-mtt-btn"
            disabled={disabled}
            onClick={() => onAction("mtt")}
          >
            {mttLabel}
          </button>
        </div>
        <p className="muted small">Multi-table events always seat 8 per table.</p>
      </div>

      <div className="lobby-mode-group">
        <h3 className="lobby-mode-heading">Omaha</h3>
        <div className="lobby-mode-row">
          <button type="button" className="secondary" disabled={disabled} onClick={() => onAction("plo4")}>
            PLO cash
          </button>
          <button type="button" className="secondary" disabled={disabled} onClick={() => onAction("sng_plo8")}>
            PLO 8-max SNG
          </button>
          <button type="button" className="secondary" disabled={disabled} onClick={() => onAction("mtt_plo16")}>
            PLO 16 SNG
          </button>
          <button
            type="button"
            className="secondary lobby-mtt-btn"
            disabled={disabled}
            onClick={() => onAction("mtt_plo500")}
          >
            PLO 500 MTT
          </button>
        </div>
      </div>

      <div className="lobby-mode-group lobby-mode-more">
        <button
          type="button"
          className="lobby-mode-more-toggle"
          aria-expanded={moreOpen}
          onClick={onToggleMore}
        >
          {moreOpen ? "Hide more games" : "More games"}
          <span className="lobby-mode-more-chevron" aria-hidden>
            {moreOpen ? "▴" : "▾"}
          </span>
        </button>
        {moreOpen && (
          <div className="lobby-mode-more-body">
            <p className="muted small">Cash tables · beta variants</p>
            <div className="lobby-mode-row">
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("plo4_hl")}
              >
                PLO Hi/Lo
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("pineapple")}
              >
                Pineapple
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("crazy_pineapple")}
              >
                Crazy Pineapple
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("lazy_pineapple")}
              >
                Lazy Pineapple
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("five_card_draw")}
              >
                5-Card Draw
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("triple_draw_27")}
              >
                2-7 Triple Draw
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("badugi")}
              >
                Badugi
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("seven_card_stud")}
              >
                7-Card Stud
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onAction("razz")}
              >
                Razz
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
