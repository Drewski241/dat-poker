import type { DatTokenInfo, HandResult, HandState, PlayerAction, TableSeat } from "../api.js";
import { computeNlheBetRange, formatDatMojos } from "@dat-poker/shared";
import { BetSlider } from "./BetSlider.js";
import { CardRow } from "./PlayingCard.js";

const HOUSE_PLAYER_ID = "dat-poker:house";

type Props = {
  datToken: DatTokenInfo | null;
  playerId: string;
  tableSeats: TableSeat[];
  dealerButtonSeat: number | null;
  tableStackMojos: string | null;
  hand: HandState | null;
  handResult: HandResult | null;
  handInProgress: boolean;
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
  busy: boolean;
  liveHandLabel: string | null;
  isMyAction: boolean;
  actionSecondsLeft: number;
  canCheck: boolean;
  toCall: bigint;
  betRange: ReturnType<typeof computeNlheBetRange>;
  betAmountMojos: bigint;
  myStack: bigint;
  onBetAmountChange: (v: bigint) => void;
  onSendAction: (action: PlayerAction, amountMojos?: string) => void;
  onStartHand: () => void;
  onOpenLobby: () => void;
  playerLabel: (id: string, youId: string | null, display?: string) => string;
  seatPositionLabel: (seatIndex: number, hand: HandState | null, dealerButtonSeat: number | null) => string;
  handCategoryLabel: (category: string) => string;
};

export function TableRoom({
  datToken,
  playerId,
  tableSeats,
  dealerButtonSeat,
  tableStackMojos,
  hand,
  handResult,
  handInProgress,
  smallBlindMojos,
  bigBlindMojos,
  busy,
  liveHandLabel,
  isMyAction,
  actionSecondsLeft,
  canCheck,
  toCall,
  betRange,
  betAmountMojos,
  myStack,
  onBetAmountChange,
  onSendAction,
  onStartHand,
  onOpenLobby,
  playerLabel,
  seatPositionLabel,
  handCategoryLabel,
}: Props) {
  const actionSeatPlayer =
    hand?.actionSeat != null
      ? hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded)
      : null;

  const canStepToLobby = !hand && !handInProgress;

  return (
    <div className="table-room">
      <header className="table-room-header">
        <div className="table-room-header-main">
          <h1 className="table-room-title">6-max table</h1>
          {tableStackMojos && (
            <p className="table-room-stack">
              Stack{" "}
              <strong>{formatDatMojos(tableStackMojos, datToken?.ticker)}</strong>
            </p>
          )}
        </div>
        <button
          type="button"
          className="secondary table-room-lobby-btn"
          disabled={busy || !canStepToLobby}
          title={canStepToLobby ? "Account, withdraw, leave table" : "Finish or wait for the hand to end"}
          onClick={onOpenLobby}
        >
          Lobby
        </button>
      </header>

      <div className="table-room-seats" aria-label="Seats">
        {Array.from({ length: 6 }, (_, i) => {
          const seated = tableSeats.find((s) => s.seatIndex === i);
          const inHand = hand?.players.find((p) => p.seatIndex === i);
          const acting = hand?.actionSeat === i && inHand && !inHand.folded;
          return (
            <div
              key={i}
              className={`table-room-seat ${seated ? "occupied" : "empty"} ${acting ? "acting" : ""} ${inHand?.folded ? "folded" : ""}`}
            >
              <span className="table-room-seat-num">{i + 1}</span>
              {seated ? (
                <>
                  <span className="table-room-seat-name">
                    {playerLabel(seated.playerId, playerId, seated.displayAddress)}
                  </span>
                  <span className="table-room-seat-stack">
                    {formatDatMojos(
                      inHand?.stackMojos ?? seated.stackMojos,
                      datToken?.ticker,
                    )}
                  </span>
                  <span className="table-room-seat-role">
                    {seatPositionLabel(i, hand, dealerButtonSeat).replace(/^ · /, "")}
                    {acting ? " · acting" : ""}
                    {inHand?.folded ? " · folded" : ""}
                  </span>
                </>
              ) : (
                <span className="table-room-seat-empty">Empty</span>
              )}
            </div>
          );
        })}
      </div>

      <main className="table-room-main">
        {!hand ? (
          <div className="table-room-between">
            {handResult && (
              <div
                className={
                  handResult.winnerId === playerId ? "banner win table-room-result" : "banner info table-room-result"
                }
              >
                <strong>
                  {playerLabel(
                    handResult.winnerId,
                    playerId,
                    tableSeats.find((s) => s.playerId === handResult.winnerId)?.displayAddress,
                  )}
                </strong>
                {handResult.winnerId === playerId ? " win " : " wins "}
                {formatDatMojos(handResult.potMojos, datToken?.ticker)}
                {handResult.reason === "showdown" ? " at showdown" : " (fold)"}
                {handResult.reason === "showdown" && handResult.board && handResult.board.length > 0 && (
                  <CardRow label="Board" cards={handResult.board} size="lg" />
                )}
                {handResult.reason === "showdown" && (handResult.shown?.length ?? 0) > 0 && (
                  <ul className="showdown-hands">
                    {handResult.shown!.map((shown) => (
                      <li key={shown.playerId}>
                        <div className="player-meta">
                          <strong>
                            {playerLabel(
                              shown.playerId,
                              playerId,
                              tableSeats.find((s) => s.playerId === shown.playerId)?.displayAddress,
                            )}
                          </strong>
                          {" — "}
                          {handCategoryLabel(shown.category)}
                          {shown.playerId === handResult.winnerId ? " (winner)" : ""}
                        </div>
                        <CardRow
                          cards={shown.holeCards}
                          size={shown.playerId === playerId ? "lg" : "md"}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <button
              type="button"
              className="table-room-deal-btn"
              disabled={busy || tableSeats.length < 2}
              onClick={onStartHand}
            >
              {handResult ? "New hand" : "Deal hand"}
            </button>
            <p className="muted small table-room-hint">
              House fills empty seats. Use Lobby between hands for account &amp; withdraw.
            </p>
          </div>
        ) : (
          <>
            <div className="table-room-hand-meta">
              <p>
                <strong>{hand.street}</strong> · Pot{" "}
                <strong>{formatDatMojos(hand.potMojos, datToken?.ticker)}</strong>
              </p>
              <p className="hand-blinds-line">
                D{hand.dealerSeat + 1} · SB{hand.smallBlindSeat + 1} · BB{hand.bigBlindSeat + 1} ·{" "}
                {formatDatMojos(smallBlindMojos.toString(), datToken?.ticker)} /{" "}
                {formatDatMojos(bigBlindMojos.toString(), datToken?.ticker)}
              </p>
            </div>
            {liveHandLabel && (
              <p className="live-hand table-room-live-hand">
                Your hand: <strong>{liveHandLabel}</strong>
              </p>
            )}
            {hand.board.length > 0 && (
              <CardRow label="Board" cards={hand.board} size="lg" />
            )}
            <ul className="players table-room-players">
              {hand.players.map((p) => (
                <li key={p.playerId} className={p.playerId === playerId ? "you" : ""}>
                  <div className="player-meta">
                    <strong>
                      {p.playerId === playerId
                        ? "You"
                        : p.playerId === HOUSE_PLAYER_ID
                          ? "House"
                          : playerLabel(
                              p.playerId,
                              playerId,
                              tableSeats.find((s) => s.playerId === p.playerId)?.displayAddress,
                            )}
                    </strong>
                    {p.folded ? " — folded" : ""}
                    <span className="stack">
                      {" "}
                      {formatDatMojos(p.stackMojos, datToken?.ticker)}
                    </span>
                  </div>
                  {p.holeCards.length > 0 && (
                    <CardRow cards={p.holeCards} size={p.playerId === playerId ? "lg" : "md"} />
                  )}
                </li>
              ))}
            </ul>
            {!isMyAction && actionSeatPlayer && (
              <p className="muted table-room-wait">
                Waiting for{" "}
                {playerLabel(
                  actionSeatPlayer.playerId,
                  playerId,
                  tableSeats.find((s) => s.playerId === actionSeatPlayer.playerId)?.displayAddress,
                )}
                …
              </p>
            )}
          </>
        )}
      </main>

      {hand && isMyAction && (
        <footer className="table-room-actions">
          <div className="actions your-turn">
            <div className="action-bar-top">
              <span className="action-bar-label">Your action · {actionSecondsLeft}s</span>
              <div className="action-buttons-row">
                <button
                  type="button"
                  className="primary-bet"
                  disabled={busy}
                  onClick={() => onSendAction("fold")}
                >
                  fold
                </button>
                {canCheck ? (
                  <button type="button" disabled={busy} onClick={() => onSendAction("check")}>
                    check
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => onSendAction("call")}>
                    call {formatDatMojos(toCall.toString(), datToken?.ticker)}
                  </button>
                )}
                {betRange.canBetOrRaise && (
                  <button
                    type="button"
                    className="primary-bet action-bet-submit"
                    disabled={busy}
                    onClick={() =>
                      onSendAction(
                        betRange.isOpeningBet ? "bet" : "raise",
                        betAmountMojos.toString(),
                      )
                    }
                  >
                    {betRange.isOpeningBet ? "bet" : "raise to"}{" "}
                    {formatDatMojos(betAmountMojos.toString(), datToken?.ticker)}
                  </button>
                )}
                {myStack > 0n && (
                  <button type="button" disabled={busy} onClick={() => onSendAction("all-in")}>
                    all-in
                  </button>
                )}
              </div>
            </div>
            {betRange.canBetOrRaise && (
              <div className="action-bet-panel">
                <BetSlider
                  label={betRange.isOpeningBet ? "Bet size" : "Raise to"}
                  minMojos={betRange.minRaiseTo}
                  maxMojos={betRange.maxRaiseTo}
                  stepMojos={bigBlindMojos}
                  bigBlindMojos={bigBlindMojos}
                  valueMojos={betAmountMojos}
                  ticker={datToken?.ticker}
                  disabled={busy}
                  onChange={onBetAmountChange}
                />
              </div>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
