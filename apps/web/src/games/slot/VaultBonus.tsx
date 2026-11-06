import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import { api } from "../../api.js";
import { usePlaySession } from "../../play/PlaySessionContext.js";

export type VaultBonusView = {
  bonusId: string;
  gameId: string;
  gameTitle: string;
  betMojos: string;
  cards: Array<
    | { index: number; revealed: false }
    | { index: number; revealed: true; kind: "prize"; multiplier: number; payoutMojos: string }
    | { index: number; revealed: true; kind: "rake" }
  >;
  collectedMojos: string;
  open: true;
};

type VaultContextValue = {
  bonusOpen: boolean;
  noteUnlock: (bonus: VaultBonusView) => void;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVaultBonus(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) return { bonusOpen: false, noteUnlock: () => {} };
  return ctx;
}

export function VaultBonusProvider({
  playerId,
  ticker,
  children,
}: {
  playerId: string | null;
  ticker: string;
  children: ReactNode;
}) {
  const { refreshSession } = usePlaySession();
  const [bonus, setBonus] = useState<VaultBonusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishedNote, setFinishedNote] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) {
      setBonus(null);
      setFinishedNote(null);
      return;
    }
    let cancelled = false;
    void api.getVaultBonus().then((body) => {
      if (!cancelled) setBonus(body.bonus);
    }).catch(() => {
      /* the lobby still loads if this read fails */
    });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const noteUnlock = useCallback((next: VaultBonusView) => {
    setFinishedNote(null);
    setError(null);
    setBonus(next);
  }, []);

  const finish = useCallback(
    async (collectedMojos: string, hitRake: boolean) => {
      setBonus(null);
      const amount = formatDatMojos(collectedMojos, ticker);
      setFinishedNote(
        hitRake
          ? `The rake ended the vault. You keep ${amount}.`
          : `Vault cashed out for ${amount}.`,
      );
      if (playerId) await refreshSession(playerId);
    },
    [playerId, refreshSession, ticker],
  );

  const onFlip = async (index: number) => {
    if (!playerId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.flipVaultChip(index);
      if (result.finished) {
        await finish(result.collectedMojos, result.hitRake);
      } else if (result.bonus) {
        setBonus(result.bonus);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCashOut = async () => {
    if (!playerId || busy || !bonus) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.cashOutVaultBonus();
      await finish(result.collectedMojos, false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const collected = BigInt(bonus?.collectedMojos ?? "0");

  return (
    <VaultContext.Provider value={{ bonusOpen: Boolean(bonus), noteUnlock }}>
      {children}
      {bonus && (
        <div className="vault-overlay" role="dialog" aria-modal="true" aria-labelledby="vault-title">
          <div className="vault-card">
            <p className="vault-kicker">Bonus unlocked</p>
            <h2 id="vault-title">Crack the Vault</h2>
            <p className="muted">
              {bonus.gameTitle} opened this at {formatDatMojos(bonus.betMojos, ticker)}. Flip a chip.
              Cash out before the rake, and the chips you already turned stay yours.
            </p>
            <ul className="vault-chips">
              {bonus.cards.map((card) => (
                <li key={card.index}>
                  <button
                    type="button"
                    className={`vault-chip${card.revealed ? " revealed" : ""}${card.revealed && card.kind === "rake" ? " rake" : ""}`}
                    disabled={busy || card.revealed}
                    onClick={() => void onFlip(card.index)}
                  >
                    {card.revealed && card.kind === "prize" ? (
                      <>
                        <span className="vault-chip-mult">{card.multiplier}×</span>
                        <span>{formatDatMojos(card.payoutMojos, ticker)}</span>
                      </>
                    ) : card.revealed ? (
                      <>
                        <span className="vault-chip-mult">Rake</span>
                        <span>Round over</span>
                      </>
                    ) : (
                      <>
                        <span className="vault-chip-mult">?</span>
                        <span>Flip</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="vault-collected">
              So far <strong>{formatDatMojos(bonus.collectedMojos, ticker)}</strong>
            </p>
            {error && <p className="banner error">{error}</p>}
            <button type="button" className="cta" disabled={busy || collected <= 0n} onClick={() => void onCashOut()}>
              {collected > 0n ? `Cash out ${formatDatMojos(bonus.collectedMojos, ticker)}` : "Flip a chip to cash out"}
            </button>
          </div>
        </div>
      )}
      {finishedNote && !bonus && (
        <div className="vault-overlay" role="dialog" aria-modal="true" aria-labelledby="vault-done-title">
          <div className="vault-card">
            <h2 id="vault-done-title">Vault closed</h2>
            <p>{finishedNote}</p>
            <button type="button" className="cta" onClick={() => setFinishedNote(null)}>
              Back to the slots
            </button>
          </div>
        </div>
      )}
    </VaultContext.Provider>
  );
}
