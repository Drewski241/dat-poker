import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  type OpsFeedbackItem,
  type OpsMetricsSnapshot,
  type OpsStatus,
} from "./api.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";

const OPS_TOKEN_KEY = "dat-poker-ops-token-v1";

function loadToken(): string {
  try {
    return sessionStorage.getItem(OPS_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(OPS_TOKEN_KEY, token);
    else sessionStorage.removeItem(OPS_TOKEN_KEY);
  } catch {
    /* private browsing */
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function Ops({ onNavigate }: { onNavigate: (page: SitePage) => void }) {
  const [tokenInput, setTokenInput] = useState(() => loadToken());
  const [token, setToken] = useState(() => loadToken());
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [metrics, setMetrics] = useState<OpsMetricsSnapshot | null>(null);
  const [feedback, setFeedback] = useState<OpsFeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (opsToken: string) => {
    setBusy(true);
    setError(null);
    try {
      const [st, met, fb] = await Promise.all([
        api.opsStatus(opsToken),
        api.opsMetrics(opsToken),
        api.opsFeedback(opsToken),
      ]);
      setStatus(st);
      setMetrics(met);
      setFeedback(fb.feedback);
    } catch (e) {
      setStatus(null);
      setMetrics(null);
      setFeedback([]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (token.length >= 8) void refresh(token);
  }, [token, refresh]);

  const onUnlock = (event: FormEvent) => {
    event.preventDefault();
    const next = tokenInput.trim();
    saveToken(next);
    setToken(next);
  };

  const onClear = () => {
    saveToken("");
    setTokenInput("");
    setToken("");
    setStatus(null);
    setMetrics(null);
    setFeedback([]);
    setError(null);
  };

  const patchFeedback = async (
    id: string,
    body: { label?: string; status?: string; triageNote?: string },
  ) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.opsPatchFeedback(token, id, body);
      await refresh(token);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="app landing">
      <header>
        <SiteNav page="ops" onNavigate={onNavigate} />
        <h1>Ops</h1>
        <p className="tagline">Host metrics + feedback triage (token required)</p>
      </header>

      <section className="panel ops-panel">
        <form className="ops-unlock" onSubmit={onUnlock}>
          <label className="ops-token-label">
            Ops token
            <input
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="DAT_OPS_TOKEN from host .env"
            />
          </label>
          <div className="row">
            <button type="submit" disabled={busy || tokenInput.trim().length < 8}>
              Unlock
            </button>
            <button type="button" className="secondary" disabled={busy || !token} onClick={onClear}>
              Clear
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !token}
              onClick={() => void refresh(token)}
            >
              Refresh
            </button>
          </div>
        </form>
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
      </section>

      {status && metrics && (
        <>
          <section className="panel ops-panel">
            <h2>Today ({metrics.day} UTC)</h2>
            <ul className="ops-stat-list">
              <li>
                <strong>{status.today.dau}</strong> <span className="muted">DAU</span>
              </li>
              <li>
                <strong>{status.today.handsCompleted}</strong>{" "}
                <span className="muted">hands</span>
              </li>
              <li>
                <strong>{status.today.handsPerActivePlayer}</strong>{" "}
                <span className="muted">hands / active</span>
              </li>
              <li>
                <strong>{status.openFeedback}</strong> <span className="muted">open feedback</span>
              </li>
            </ul>
            <p className="muted small">
              Build {status.buildRef ?? "unknown"} · uptime {formatUptime(status.uptimeSeconds)} ·{" "}
              {status.tables} tables · {status.seatedHumans} seated · {status.humansInHand} in hand
            </p>
            <h3 className="ops-subhead">Drop-off street</h3>
            <ul className="ops-dropoff muted small">
              {Object.entries(metrics.dropOffStreet).map(([street, n]) => (
                <li key={street}>
                  {street}: {n}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel ops-panel">
            <h2>Feedback triage</h2>
            {feedback.length === 0 ? (
              <p className="muted small">No feedback notes yet.</p>
            ) : (
              <ul className="ops-feedback-list">
                {feedback.map((item) => (
                  <li key={item.id} className="ops-feedback-item">
                    <p className="ops-feedback-meta muted small">
                      {item.createdAt.slice(0, 16).replace("T", " ")} UTC · {item.page || "—"} ·{" "}
                      {item.contact || "no contact"}
                    </p>
                    <p className="ops-feedback-comment">{item.comment}</p>
                    <div className="ops-feedback-controls row">
                      <label>
                        Label
                        <select
                          value={item.label}
                          disabled={busy}
                          onChange={(e) => void patchFeedback(item.id, { label: e.target.value })}
                        >
                          {(status.feedbackLabels ?? []).map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Status
                        <select
                          value={item.status}
                          disabled={busy}
                          onChange={(e) => void patchFeedback(item.id, { status: e.target.value })}
                        >
                          {(status.feedbackStatuses ?? []).map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {item.triageNote && (
                      <p className="muted small">Note: {item.triageNote}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
