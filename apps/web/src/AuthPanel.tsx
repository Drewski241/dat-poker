import { useState, type FormEvent } from "react";

export function AuthPanel({
  busy,
  onAuth,
}: {
  busy: boolean;
  onAuth: (mode: "register" | "login", fields: { username: string; password: string; email?: string }) => void;
}) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    onAuth(mode, {
      username: username.trim(),
      password,
      email: email.trim() || undefined,
    });
  };

  return (
    <form className="feedback-form" onSubmit={onSubmit}>
      <div className="row">
        <button
          type="button"
          className={mode === "register" ? undefined : "secondary"}
          disabled={busy}
          onClick={() => setMode("register")}
        >
          Create account
        </button>
        <button
          type="button"
          className={mode === "login" ? undefined : "secondary"}
          disabled={busy}
          onClick={() => setMode("login")}
        >
          Sign in
        </button>
      </div>
      <label htmlFor="auth-username">Username</label>
      <input
        id="auth-username"
        name="username"
        autoComplete="username"
        required
        minLength={3}
        maxLength={20}
        pattern="[A-Za-z][A-Za-z0-9_]{2,19}"
        title="3–20 characters, start with a letter, then letters, numbers, or _"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        disabled={busy}
      />
      <label htmlFor="auth-password">Password</label>
      <input
        id="auth-password"
        name="password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
      />
      {mode === "register" && (
        <>
          <label htmlFor="auth-email">Email (optional)</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </>
      )}
      <div className="row">
        <button type="submit" disabled={busy}>
          {mode === "register" ? "Create account" : "Sign in"}
        </button>
      </div>
      <p className="muted small">
        Play and redeem funded DAT with this account. Connect Sage later only if you
        want DAT in your wallet.
      </p>
    </form>
  );
}
