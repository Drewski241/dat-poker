import { useState } from "react";
import type { PlayerPose } from "./slots/PlayerCharacter.js";

export function LoginScreen({
  busy,
  error,
  status,
  apiOk,
  onPose,
  onLogin,
}: {
  busy: boolean;
  error: string | null;
  status: string;
  apiOk: boolean | null;
  onPose: (pose: PlayerPose) => void;
  onLogin: (displayName: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <>
      <header>
        <h1>DAT</h1>
        <p className="tagline">How to play DAT Slots</p>
      </header>

      <ol className="howto">
        <li>Log in.</li>
        <li>Select DAT Slots.</li>
        <li>Press Spin. Match three symbols on a line.</li>
      </ol>

      {apiOk === false && <div className="banner error">API offline. Start the API, then refresh.</div>}
      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner info">{status}</div>}

      <section className="panel">
        <h2>Log in</h2>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) onLogin(name);
          }}
        >
          <label htmlFor="login-name">Player name</label>
          <input
            id="login-name"
            value={name}
            autoComplete="nickname"
            maxLength={20}
            disabled={busy || apiOk === false}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            id="login-submit"
            type="submit"
            disabled={busy || apiOk === false || name.trim().length < 2}
            onPointerDown={() => onPose("reaching")}
            onPointerUp={() => onPose("seated")}
            onPointerLeave={() => onPose("seated")}
          >
            Log in
          </button>
        </form>
      </section>
    </>
  );
}
