import { useEffect, useState } from "react";
import type { DatTokenInfo, HandResult, HandState, PlayerAction, SngSnapshot, TableSeat } from "../api.js";
import { computeNlheBetRange, formatDatAmount, formatDatMojos } from "@dat-poker/shared";
import { formatHandCategory } from "../all-in-runout.js";
import { AllInRunout } from "./AllInRunout.js";
import { BetSlider } from "./BetSlider.js";
import { CardRow, PlayingCard } from "./PlayingCard.js";

function formatBlindCountdown(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sngBlindClockLine(sng: SngSnapshot, nowMs: number): string {
  const level = (sng.levelIndex ?? 0) + 1;
  const nextBlinds =
    sng.nextSmallBlindMojos && sng.nextBigBlindMojos
      ? `next ${formatDatAmount(sng.nextSmallBlindMojos)}/${formatDatAmount(sng.nextBigBlindMojos)}`
      : "";
  if (sng.status === "registering") {
    return `L${level}${nextBlinds ? ` · ${nextBlinds} after start` : ""}`;
  }
  if (sng.status !== "running") {
    return `L${level}`;
  }
  if (sng.blindsUpNextHand || sng.handsUntilNextLevel === 1) {
    return `L${level}${nextBlinds ? ` · ${nextBlinds}` : ""} · next hand`;
  }
  if (sng.nextLevelAtMs != null) {
    return `L${level}${nextBlinds ? ` · ${nextBlinds}` : ""} in ${formatBlindCountdown(sng.nextLevelAtMs - nowMs)}`;
  }
  return `L${level} · final`;
}

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
  canRebuy: boolean;
  canDeal?: boolean;
  onRebuy: () => void;
  rebuyLabel: string;
  onOpenLobby: () => void;
  handHistoryCount: number;
  onOpenHandHistory: () => void;
  playerLabel: (id: string, youId: string | null, display?: string) => string;
  seatPositionLabel: (seatIndex: number, hand: HandState | null, dealerButtonSeat: number | null) => string;
  maxSeats?: number;
  tableTitle?: string;
  sng?: SngSnapshot | null;
  runoutFromBoardLen?: number | null;
  onRunoutFinished?: () => void;
  playthroughHandsPlayed?: number;
  playthroughHandsRequired?: number;
  playthroughUnlockedMojos?: string;
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
  canRebuy,
  canDeal = true,
  onRebuy,
  rebuyLabel,
  onOpenLobby,
  handHistoryCount,
  onOpenHandHistory,
  playerLabel,
  seatPositionLabel,
  maxSeats = 6,
  tableTitle = "6-max",
  sng = null,
  runoutFromBoardLen = null,
  onRunoutFinished,
  playthroughHandsPlayed = 0,
  playthroughHandsRequired = 0,
  playthroughUnlockedMojos = "0",
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!sng || sng.status !== "running" || sng.nextLevelAtMs == null) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sng?.status, sng?.nextLevelAtMs]);
  const actionSeatPlayer =
    hand?.actionSeat != null
      ? hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded)
      : null;

  const canStepToLobby = !hand && !handInProgress;
  const runoutPlaying = Boolean(handResult && runoutFromBoardLen != null && onRunoutFinished);
  const showDeal = !hand && !canRebuy && canDeal && !runoutPlaying;
  const showBetweenFooter = !hand && (showDeal || canRebuy) && !runoutPlaying;
  const buttonSeatIndex = hand?.dealerSeat ?? dealerButtonSeat;

  const me = hand?.players.find((p) => p.playerId === playerId);
  const opponents = (hand?.players.filter((p) => p.playerId !== playerId) ?? []).slice().sort((a, b) => {
    const aAct = hand && hand.actionSeat === a.seatIndex && !a.folded ? 0 : 1;
    const bAct = hand && hand.actionSeat === b.seatIndex && !b.folded ? 0 : 1;
    return aAct - bAct;
  });
  const actorName = actionSeatPlayer
    ? playerLabel(
        actionSeatPlayer.playerId,
        playerId,
        tableSeats.find((s) => s.playerId === actionSeatPlayer.playerId)?.displayAddress,
      )
    : null;

  return (
    <div
      className={`table-room ${hand ? "table-room-in-hand" : "table-room-between-hands"}${hand && isMyAction ? " table-room-has-actions" : ""}${showBetweenFooter ? " table-room-has-actions" : ""}${runoutPlaying ? " table-room-runout-playing" : ""}`}
    >
      <header className="table-room-header">
        <div className="table-room-header-main">
          <h1 className="table-room-title">
            {tableTitle}
            {tableStackMojos && (
              <>
                {" "}
                ·{" "}
                <strong>{formatDatMojos(tableStackMojos, datToken?.ticker)}</strong>
              </>
            )}
          </h1>
          <p className="table-room-blind-clock">
            Blinds {formatDatAmount(smallBlindMojos)}/{formatDatAmount(bigBlindMojos)}
            {sng ? ` · ${sngBlindClockLine(sng, nowMs)}` : ""}
          </p>
          {sng && (
            <p className="table-room-sng-payouts">
              Buy-in {formatDatMojos(sng.buyInMojos, datToken?.ticker)} · pool{" "}
              {formatDatMojos(sng.prizePoolMojos, datToken?.ticker)} · pays 1st–3rd 50/30/20
              {sng.payouts?.length
                ? ` (${sng.payouts
                    .map((row) => `${row.place} ${formatDatMojos(row.prizeMojos, datToken?.ticker)}`)
                    .join(" · ")})`
                : ""}
            </p>
          )}
          {playthroughHandsRequired > 0 && (
            <p className="table-room-playthrough">
              Play-through {playthroughHandsPlayed}/{playthroughHandsRequired} hands ·{" "}
              {formatDatMojos(playthroughUnlockedMojos, datToken?.ticker)} unlocked
              {sng ? " from leftover account DAT or prizes" : ""}
            </p>
          )}
        </div>
        <div className="table-room-header-actions">
          <button
            type="button"
            className="table-room-history-link"
            disabled={busy}
            onClick={onOpenHandHistory}
          >
            Hand history{handHistoryCount > 0 ? ` (${handHistoryCount})` : ""}
          </button>
          <button
            type="button"
            className="secondary table-room-lobby-btn"
            disabled={busy || !canStepToLobby}
            title={canStepToLobby ? "Account, withdraw, leave table" : "Finish or wait for the hand to end"}
            onClick={onOpenLobby}
          >
            Lobby
          </button>
        </div>
      </header>

      {!hand && !runoutPlaying && (
        <div className="table-room-seats" aria-label="Seats">
          {Array.from({ length: maxSeats }, (_, i) => {
            const seated = tableSeats.find((s) => s.seatIndex === i);
            const isDealer = buttonSeatIndex === i;
            return (
              <div
                key={i}
                className={`table-room-seat ${seated ? "occupied" : "empty"}${isDealer ? " table-room-seat-dealer" : ""}`}
              >
                <span className="table-room-seat-num">
                  {isDealer ? (
                    <span className="table-room-dealer-chip" title="Dealer button">
                      D
                    </span>
                  ) : (
                    i + 1
                  )}
                </span>
                {seated ? (
                  <>
                    <span className="table-room-seat-name">
                      {playerLabel(seated.playerId, playerId, seated.displayAddress)}
                    </span>
                    <span className="table-room-seat-stack">
                      {formatDatMojos(seated.stackMojos, datToken?.ticker)}
                    </span>
                    <span className="table-room-seat-role">
                      {seatPositionLabel(i, hand, dealerButtonSeat).replace(/^ · /, "")}
                    </span>
                  </>
                ) : (
                  <span className="table-room-seat-empty">Empty</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <main className={`table-room-main ${hand ? "table-room-main-in-hand" : "table-room-main-between"}`}>
        {!hand ? (
          <div className="table-room-between">
            {handResult && runoutFromBoardLen != null && onRunoutFinished && (
              <AllInRunout
                result={handResult}
                fromBoardLen={runoutFromBoardLen}
                datToken={datToken}
                playerId={playerId}
                playerLabel={playerLabel}
                seatDisplay={(id) => tableSeats.find((s) => s.playerId === id)?.displayAddress}
                onFinished={onRunoutFinished}
              />
            )}
            {handResult && runoutFromBoardLen == null && (
              <div
                className={
                  handResult.winnerId === playerId
                    ? "table-room-result table-room-result-win"
                    : "table-room-result"
                }
              >
                <p className="table-room-result-line">
                  <strong>
                    {playerLabel(
                      handResult.winnerId,
                      playerId,
                      tableSeats.find((s) => s.playerId === handResult.winnerId)?.displayAddress,
                    )}
                  </strong>
                  {handResult.winnerId === playerId ? " win " : " wins "}
                  {formatDatMojos(handResult.potMojos, datToken?.ticker)}
                  {handResult.reason === "showdown" ? " · showdown" : " · fold"}
                </p>
                {handResult.reason === "showdown" && (handResult.board?.length ?? 0) > 0 && (
                  <CardRow cards={handResult.board!} size="sm" />
                )}
                {handResult.reason === "showdown" && (handResult.shown?.length ?? 0) > 0 && (
                  <div className="table-room-showdown-strip">
                    {handResult.shown!.map((shown) => (
                      <div
                        key={shown.playerId}
                        className={`table-room-showdown-entry ${shown.playerId === handResult.winnerId ? "is-winner" : "is-loser"}`}
                      >
                        <span className="table-room-showdown-name">
                          {playerLabel(
                            shown.playerId,
                            playerId,
                            tableSeats.find((s) => s.playerId === shown.playerId)?.displayAddress,
                          )}
                          {shown.playerId === handResult.winnerId ? " ★" : ""}
                        </span>
                        <CardRow cards={shown.holeCards} size="sm" />
                        <span className="table-room-showdown-cat">{formatHandCategory(shown.category)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {tableStackMojos != null && BigInt(tableStackMojos) === 0n && !canRebuy && !runoutPlaying && (
              <p className="banner info table-room-bust">
                {canDeal
                  ? "You have no chips at this table. Wait for the hand to finish, then buy in again, or open Lobby to redeem DAT."
                  : "You are out of this sit-n-go. Open Lobby to return to your account."}
              </p>
            )}
          </div>
        ) : (
          <section className="table-room-felt" aria-label="Hand">
            <div className="table-room-hand-meta">
              <p className="table-room-street-pot">
                <strong>{hand.street}</strong> · Pot{" "}
                <strong>{formatDatMojos(hand.potMojos, datToken?.ticker)}</strong>
                <span className="hand-blinds-line">
                  {" "}
                  · {formatDatAmount(smallBlindMojos)}/{formatDatAmount(bigBlindMojos)} · D
                  {hand.dealerSeat + 1} SB{hand.smallBlindSeat + 1} BB{hand.bigBlindSeat + 1}
                </span>
              </p>
              {actorName && (
                <p
                  className={`table-room-turn-banner ${isMyAction ? "table-room-turn-banner-you" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  {isMyAction ? "Your turn to bet" : `${actorName} is betting`}
                </p>
              )}
            </div>

            <div className="table-room-board">
              <span className="card-row-label">Board</span>
              <div className="table-room-board-cards">
                {Array.from({ length: 5 }, (_, i) => {
                  const card = hand.board[i];
                  return card ? (
                    <PlayingCard key={`b-${i}`} card={card} size="md" />
                  ) : (
                    <span
                      key={`b-empty-${i}`}
                      className="playing-card playing-card-md playing-card-slot"
                      aria-hidden="true"
                    />
                  );
                })}
              </div>
            </div>

            <ul className="table-room-opponents">
              {opponents.map((p) => {
                const acting = hand.actionSeat === p.seatIndex && !p.folded;
                return (
                  <li
                    key={p.playerId}
                    className={`table-room-opponent ${p.folded ? "folded" : ""} ${acting ? "acting" : ""}`}
                  >
                    <div className="table-room-opponent-meta">
                      <strong>
                        {hand.dealerSeat === p.seatIndex && (
                          <span className="table-room-dealer-chip table-room-dealer-chip-inline" title="Dealer">
                            D{" "}
                          </span>
                        )}
                        {playerLabel(
                          p.playerId,
                          playerId,
                          tableSeats.find((s) => s.playerId === p.playerId)?.displayAddress,
                        )}
                      </strong>
                      {p.folded ? " · folded" : ""}
                      {acting ? <span className="to-act-badge">Betting</span> : null}
                      <span className="stack">{formatDatMojos(p.stackMojos, datToken?.ticker)}</span>
                    </div>
                    {p.holeCards.length > 0 && !p.folded && (
                      <CardRow cards={p.holeCards} size="sm" />
                    )}
                  </li>
                );
              })}
            </ul>

            {me && (
              <div className={`table-room-hero ${isMyAction ? "your-turn" : ""}`}>
                <div className="table-room-hero-meta">
                  <strong>
                    {hand.dealerSeat === me.seatIndex && (
                      <span className="table-room-dealer-chip table-room-dealer-chip-inline" title="Dealer">
                        D{" "}
                      </span>
                    )}
                    You
                  </strong>
                  {isMyAction ? <span className="to-act-badge">Betting</span> : null}
                  <span className="stack">{formatDatMojos(me.stackMojos, datToken?.ticker)}</span>
                  {liveHandLabel && (
                    <span className="live-hand table-room-live-hand">
                      · <strong>{liveHandLabel}</strong>
                    </span>
                  )}
                </div>
                {me.holeCards.length > 0 && <CardRow cards={me.holeCards} size="md" />}
              </div>
            )}

            {!isMyAction && actorName && (
              <p className="table-room-wait">
                Waiting — <strong>{actorName}</strong> is betting
              </p>
            )}
          </section>
        )}
      </main>

      {showBetweenFooter && (
        <footer className="table-room-actions table-room-between-footer">
          {canRebuy && (
            <button
              type="button"
              className="table-room-deal-btn table-room-rebuy-btn"
              disabled={busy}
              onClick={onRebuy}
            >
              Buy in again ({rebuyLabel})
            </button>
          )}
          {showDeal && (
            <button
              type="button"
              className="table-room-deal-btn"
              disabled={
                busy ||
                tableSeats.length < 2 ||
                (tableStackMojos != null && BigInt(tableStackMojos) === 0n)
              }
              onClick={onStartHand}
            >
              {handResult ? "New hand" : "Deal hand"}
            </button>
          )}
        </footer>
      )}
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
                  compact
                />
              </div>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
