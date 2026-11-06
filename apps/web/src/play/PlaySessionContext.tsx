import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type BuyInProof, type PlaySessionState } from "../api.js";

interface PlaySessionContextValue {
  session: PlaySessionState | null;
  loading: boolean;
  refreshSession: (playerId: string | null) => Promise<void>;
  redeemDaily: (playerId: string, options?: { redeemProof?: BuyInProof; devAck?: boolean }) => Promise<void>;
}

const PlaySessionContext = createContext<PlaySessionContextValue | null>(null);

export function PlaySessionProvider({
  playerId,
  children,
}: {
  playerId: string | null;
  children: ReactNode;
}) {
  const [session, setSession] = useState<PlaySessionState | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshSession = useCallback(async (id: string | null) => {
    if (!id) {
      setSession(null);
      return;
    }
    setLoading(true);
    try {
      const next = await api.getPlaySession(id);
      setSession(next);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession(playerId);
  }, [playerId, refreshSession]);

  const redeemDaily = useCallback(
    async (id: string, options?: { redeemProof?: BuyInProof; devAck?: boolean }) => {
      const result = await api.redeemDailyPlay(id, options);
      setSession({
        active: true,
        tableId: result.tableId,
        stackMojos: result.stackMojos,
        redeemAvailable: false,
        alreadyRedeemedToday: result.alreadyRedeemedToday,
        redeemUtcDay: new Date().toISOString().slice(0, 10),
        dailyRedeemMojos: result.redeemMojos,
        spinCostMojos: result.spinCostMojos,
        handInProgress: false,
        progressiveJackpotMojos: result.progressiveJackpotMojos,
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ session, loading, refreshSession, redeemDaily }),
    [session, loading, refreshSession, redeemDaily],
  );

  return <PlaySessionContext.Provider value={value}>{children}</PlaySessionContext.Provider>;
}

export function usePlaySession(): PlaySessionContextValue {
  const ctx = useContext(PlaySessionContext);
  if (!ctx) {
    throw new Error("usePlaySession must be used within PlaySessionProvider");
  }
  return ctx;
}
