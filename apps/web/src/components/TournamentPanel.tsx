import { useEffect, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import {
  api,
  type BuyInProof,
  type TournamentCustody,
  type TournamentView,
} from "../api.js";
import { signBuyInMessage, type WcSession } from "../wallet/chia-wallet.js";

interface TournamentPanelProps {
  apiOk: boolean | null;
  busy: boolean;
  ticker: string;
  session: WcSession | null;
  wcConfig: { projectId: string; chainId: string } | null;
  walletAddress: string | null;
  run: (label: string, fn: () => Promise<void>) => void;
}

function proof(address: string, message: string, signature: string, pubkey: string): BuyInProof {
  return { address, message, signature, pubkey };
}

export function TournamentPanel({
  apiOk,
  busy,
  ticker,
  session,
  wcConfig,
  walletAddress,
  run,
}: TournamentPanelProps) {
  const [siteBalance, setSiteBalance] = useState<string | null>(null);
  const [redeemEnabled, setRedeemEnabled] = useState(false);
  const [redeemMax, setRedeemMax] = useState("100000");
  const [siteNote, setSiteNote] = useState("");
  const [tournament, setTournament] = useState<TournamentView | null>(null);
  const [coinId, setCoinId] = useState("");
  const [custody, setCustody] = useState<TournamentCustody>("pool_coin");
  const [houseSeats, setHouseSeats] = useState("1");

  useEffect(() => {
    if (!walletAddress) {
      setSiteBalance(null);
      return;
    }
    void api
      .siteDat(walletAddress)
      .then((balance) => {
        setSiteBalance(balance.balanceMojos);
        setRedeemEnabled(balance.redeemEnabled);
        setRedeemMax(balance.maxRedeemMojos);
        setSiteNote(balance.note);
      })
      .catch(() => {
        setSiteBalance(null);
      });
  }, [walletAddress, tournament?.id, tournament?.status, tournament?.prizePoolMojos]);

  const refresh = async (id: string) => {
    setTournament(await api.getTournament(id));
  };

  const myEntry = tournament?.entries.find((entry) => entry.address === walletAddress);
  const players = tournament?.entries.filter((entry) => !entry.house) ?? [];
  const houseCount = tournament?.houseCount ?? 0;
  const paidCount =
    tournament?.entries.filter((entry) => entry.status === "locked" || entry.status === "seated").length ??
    0;
  const waitingOnCoin = tournament?.entries.some((entry) => entry.status === "awaiting_lock") ?? false;
  const fieldReady =
    tournament != null &&
    !waitingOnCoin &&
    (tournament.format === "sng" ? paidCount === tournament.maxEntries : paidCount >= 2);
  const canTestPayout =
    fieldReady && (myEntry?.status === "locked" || myEntry?.status === "seated");

  const createSng = (maxEntries: 8 | 16) =>
    run(`Creating ${maxEntries}-player sit & go…`, async () => {
      const created = await api.createTournament({
        format: "sng",
        buyInMojos: "1000000",
        maxEntries,
      });
      setTournament(created);
      setCoinId("");
    });

  const createOpen = () =>
    run("Creating open tournament…", async () => {
      const created = await api.createTournament({
        format: "mtt",
        buyInMojos: "1000000",
      });
      setTournament(created);
      setCoinId("");
    });

  const seatHouse = () =>
    run("Seating the house…", async () => {
      if (!tournament) return;
      const seats = tournament.format === "mtt" ? Number(houseSeats) : undefined;
      if (tournament.format === "mtt" && (!Number.isInteger(seats) || (seats ?? 0) < 1)) {
        throw new Error("House seats must be a positive whole number");
      }
      setTournament(await api.fillHouse(tournament.id, seats));
    });

  const testPayout = () =>
    run("Settling a test payout with you in 1st…", async () => {
      if (!tournament || !walletAddress) throw new Error("Connect Sage and join first");
      setTournament(await api.settleTournament(tournament.id, { playerWinsAddress: walletAddress }));
    });

  const redeem = () =>
    run("Approve the site DAT redeem in Sage…", async () => {
      if (!session || !wcConfig || !walletAddress) throw new Error("Connect Sage first");
      const nonce = crypto.randomUUID();
      const { message } = await api.siteRedeemMessage(walletAddress, redeemMax, nonce);
      const signed = await signBuyInMessage(
        session,
        wcConfig.projectId,
        wcConfig.chainId,
        message,
        walletAddress,
      );
      const result = await api.redeemSiteDat({
        address: walletAddress,
        amountMojos: redeemMax,
        nonce,
        proof: proof(walletAddress, message, signed.signature, signed.pubkey),
      });
      setSiteBalance(result.balanceMojos);
    });

  const join = () =>
    run(
      custody === "pool_coin" ? "Approve tournament entry in Sage…" : "Approve site DAT entry in Sage…",
      async () => {
        if (!session || !wcConfig || !walletAddress || !tournament) {
          throw new Error("Connect Sage and create a tournament first");
        }
        const { message } = await api.tournamentJoinMessage(tournament.id, walletAddress, custody);
        const signed = await signBuyInMessage(
          session,
          wcConfig.projectId,
          wcConfig.chainId,
          message,
          walletAddress,
        );
        const next = await api.joinTournament(tournament.id, {
          address: walletAddress,
          custody,
          proof: proof(walletAddress, message, signed.signature, signed.pubkey),
        });
        setTournament(next);
      },
    );

  const lock = () =>
    run("Approve the pool-coin id in Sage…", async () => {
      if (!session || !wcConfig || !walletAddress || !tournament || !myEntry) {
        throw new Error("Join with a pool coin first");
      }
      const normalized = coinId.trim().toLowerCase().replace(/^0x/, "");
      if (!/^[0-9a-f]{64}$/.test(normalized)) {
        throw new Error("Coin id must be 64 hex characters");
      }
      const { message } = await api.tournamentLockMessage(tournament.id, myEntry.entryId, normalized);
      const signed = await signBuyInMessage(
        session,
        wcConfig.projectId,
        wcConfig.chainId,
        message,
        walletAddress,
      );
      const next = await api.lockTournamentCoin(tournament.id, myEntry.entryId, {
        coinId: normalized,
        proof: proof(walletAddress, message, signed.signature, signed.pubkey),
      });
      setTournament(next);
    });

  const cancel = () =>
    run("Cancelling tournament…", async () => {
      if (!tournament) return;
      setTournament(await api.cancelTournament(tournament.id));
    });

  return (
    <section className="panel">
      <h2>Tournament pool</h2>
      <p className="muted small">
        A pool coin is one DAT CAT per entry. Joining always needs a Sage signature. Free site
        redeems are a separate balance and do not create that coin.
      </p>
      {siteNote && <p className="muted small">{siteNote}</p>}
      {walletAddress && (
        <p>
          Site DAT:{" "}
          <strong>{siteBalance == null ? "…" : formatDatMojos(siteBalance, ticker)}</strong>
        </p>
      )}
      <div className="row">
        <button type="button" className="secondary" disabled={busy || !apiOk} onClick={() => createSng(8)}>
          Create 8-player sit &amp; go
        </button>
        <button type="button" className="secondary" disabled={busy || !apiOk} onClick={() => createSng(16)}>
          Create 16-player sit &amp; go
        </button>
        <button type="button" className="secondary" disabled={busy || !apiOk} onClick={createOpen}>
          Create open tournament
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !session || !walletAddress || !redeemEnabled}
          onClick={redeem}
        >
          Redeem {formatDatMojos(redeemMax, ticker)} to site balance
        </button>
      </div>

      {tournament && (
        <>
          <p className="mono">
            {tournament.fieldLabel} {tournament.id}
            <br />
            {tournament.payoutNote}
            <br />
            Buy-in {formatDatMojos(tournament.buyInMojos, ticker)} · prize pool{" "}
            {formatDatMojos(tournament.prizePoolMojos, ticker)} · {tournament.status}
            <br />
            On-chain {formatDatMojos(tournament.lockedPoolMojos, ticker)} · site ledger{" "}
            {formatDatMojos(tournament.siteLedgerMojos, ticker)} · house{" "}
            {formatDatMojos(tournament.houseMojos, ticker)}
          </p>
          {(players.length > 0 || houseCount > 0) && (
            <ul className="players">
              {players.map((entry) => (
                <li key={entry.entryId}>
                  {entry.address === walletAddress ? "You" : `${entry.address.slice(0, 8)}…`} ·{" "}
                  {entry.custody === "pool_coin" ? "pool coin" : "site DAT"} · {entry.status}
                </li>
              ))}
              {houseCount > 0 && (
                <li>
                  House × {tournament.houseCount} · operator collateral
                </li>
              )}
            </ul>
          )}
          {tournament.status === "registering" && !myEntry && (
            <>
              <label className="choice">
                <input
                  type="radio"
                  name="custody"
                  checked={custody === "pool_coin"}
                  onChange={() => setCustody("pool_coin")}
                />
                Lock DAT in a pool coin
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="custody"
                  checked={custody === "site_ledger"}
                  onChange={() => setCustody("site_ledger")}
                />
                Use site DAT (no pool coin)
              </label>
              <div className="row">
                <button type="button" disabled={busy || !session || !walletAddress} onClick={join}>
                  Sign and join
                </button>
              </div>
            </>
          )}
          {myEntry?.status === "awaiting_lock" && (
            <>
              <p className="small">
                Sage signed the entry. Spend a DAT CAT of {formatDatMojos(tournament.buyInMojos, ticker)}{" "}
                whose inner puzzle is this hash, then record the coin id.
              </p>
              <p className="mono">{myEntry.innerPuzzleHash}</p>
              {myEntry.catPuzzleHash && (
                <p className="mono">CAT puzzle {myEntry.catPuzzleHash}</p>
              )}
              <input
                className="text-input"
                value={coinId}
                placeholder="64 hex coin id"
                onChange={(event) => setCoinId(event.target.value)}
              />
              <div className="row">
                <button type="button" disabled={busy || !session} onClick={lock}>
                  Sign coin id
                </button>
              </div>
            </>
          )}
          {tournament.status === "registering" && (
            <>
              <div className="row">
                {tournament.format === "mtt" && (
                  <input
                    className="text-input seats"
                    inputMode="numeric"
                    value={houseSeats}
                    aria-label="House seats"
                    onChange={(event) => setHouseSeats(event.target.value)}
                  />
                )}
                <button type="button" className="secondary" disabled={busy} onClick={seatHouse}>
                  {tournament.format === "sng"
                    ? `Seat the house (${Math.max(tournament.maxEntries - tournament.entries.length, 0)} seats)`
                    : "Seat the house"}
                </button>
                <button type="button" disabled={busy || !canTestPayout} onClick={testPayout}>
                  Test payout (you finish 1st)
                </button>
              </div>
              {!canTestPayout && (
                <p className="muted small">
                  {tournament.format === "sng"
                    ? "Lock your pool coin, then seat the house in the other seats. The test payout spends that one coin and credits the rest of 1st place."
                    : "An open tournament pays the top 20% of whoever has bought in. Seat as many house players as you want, from 1 up, then lock your coin before the test payout."}
                </p>
              )}
              <div className="row">
                <button type="button" className="secondary" disabled={busy} onClick={cancel}>
                  Cancel and refund
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void refresh(tournament.id)}
                >
                  Refresh
                </button>
              </div>
            </>
          )}
          {tournament.status === "settled" && tournament.spends && tournament.spends.length > 0 && (
            <p className="small">
              Your pool coin settles with solution{" "}
              <span className="mono">{tournament.spends[0]?.settle?.solutionHex}</span>
              {" "}and authorizer message{" "}
              <span className="mono">{tournament.spends[0]?.settle?.authorizerMessage}</span>.
              {tournament.siteCredits && tournament.siteCredits.length > 0 && (
                <>
                  {" "}
                  Site ledger credit{" "}
                  {tournament.siteCredits
                    .map((credit) => formatDatMojos(credit.amountMojos, ticker))
                    .join(", ")}
                  .
                </>
              )}
            </p>
          )}
          {tournament.status === "cancelled" && tournament.spends && tournament.spends.length > 0 && (
            <p className="small">
              Pool coins can be refunded after the timeout with solution{" "}
              <span className="mono">{tournament.spends[0]?.timeoutRefund?.solutionHex}</span>, or
              immediately with the authorizer signature.
            </p>
          )}
        </>
      )}
    </section>
  );
}
