import { useEffect, useState } from "react";
import { api, setApiAuthToken } from "./api.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";

type Props = {
  onNavigate?: (page: SitePage) => void;
  onVerified: (params: { playerId: string; username: string; token: string }) => void;
};

export function VerifyEmail({ onNavigate, onVerified }: Props) {
  const [status, setStatus] = useState<"idle" | "working" | "ok" | "err">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token")?.trim();
    if (!token) {
      setStatus("err");
      setMessage("Missing verification link. Use the link from your email or request a new one on Play.");
      return;
    }
    setStatus("working");
    void (async () => {
      try {
        const result = await api.verifyEmail(token);
        setApiAuthToken(result.token);
        setStatus("ok");
        setMessage(result.message);
        onVerified({ playerId: result.playerId, username: result.username, token: result.token });
      } catch (e) {
        setStatus("err");
        setMessage((e as Error).message);
      }
    })();
  }, [onVerified]);

  return (
    <div className="app app--lobby">
      <header>
        {onNavigate && <SiteNav page="landing" onNavigate={onNavigate} />}
        <h1>Verify email</h1>
      </header>
      <section className="panel">
        {status === "working" && <p className="muted">Confirming your email…</p>}
        {status === "ok" && <p className="ok-text">{message}</p>}
        {status === "err" && <p className="banner error">{message}</p>}
        {onNavigate && (
          <button type="button" className="secondary" onClick={() => onNavigate("play")}>
            Go to Play
          </button>
        )}
      </section>
    </div>
  );
}
