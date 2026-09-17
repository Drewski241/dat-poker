import { useState, type FormEvent } from "react";

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  name = "password",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
  name?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={8}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="secondary password-toggle"
          disabled={disabled}
          aria-pressed={show}
          aria-controls={id}
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow((open) => !open)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </>
  );
}

export function AuthPanel({
  busy,
  onAuth,
  onForgot,
  onReset,
  onResendVerification,
  awaitingEmailVerification,
  onClearAwaitingEmailVerification,
}: {
  busy: boolean;
  onAuth: (mode: "register" | "login", fields: { username: string; password: string; email?: string }) => void;
  onForgot: (fields: { username: string; email: string }) => Promise<{
    resetCode?: string;
    message: string;
  }>;
  onReset: (fields: { username: string; resetCode: string; password: string }) => Promise<void>;
  onResendVerification: (fields: { username: string; email: string }) => Promise<{ message: string }>;
  awaitingEmailVerification: { username: string; email: string } | null;
  onClearAwaitingEmailVerification: () => void;
}) {
  const [mode, setMode] = useState<"register" | "login" | "reset">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const switchMode = (next: "register" | "login" | "reset") => {
    setMode(next);
    setPassword("");
    setConfirm("");
    setResetCode("");
    setResetEmailSent(false);
    setLocalError(null);
    onClearAwaitingEmailVerification();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (mode === "reset") {
      if (!resetEmailSent) {
        requestCode();
      } else {
        submitNewPassword();
      }
      return;
    }
    if (mode === "register" && !email.trim()) {
      setLocalError("Email is required");
      return;
    }
    onAuth(mode, {
      username: username.trim(),
      password,
      email: email.trim(),
    });
  };

  const requestCode = () => {
    setLocalError(null);
    void (async () => {
      try {
        const result = await onForgot({ username: username.trim(), email: email.trim() });
        setResetEmailSent(true);
        if (import.meta.env.DEV && result.resetCode) {
          setResetCode(result.resetCode);
        }
      } catch (e) {
        setLocalError((e as Error).message);
      }
    })();
  };

  const submitNewPassword = () => {
    setLocalError(null);
    if (password !== confirm) {
      setLocalError("New passwords do not match");
      return;
    }
    void (async () => {
      try {
        await onReset({
          username: username.trim(),
          resetCode: resetCode.trim(),
          password,
        });
        setPassword("");
        setConfirm("");
        setResetCode("");
        setResetEmailSent(false);
        setMode("login");
      } catch (e) {
        setLocalError((e as Error).message);
      }
    })();
  };

  const resendVerification = () => {
    if (!awaitingEmailVerification) return;
    setLocalError(null);
    void (async () => {
      try {
        const result = await onResendVerification(awaitingEmailVerification);
        setStatusMessage(result.message);
      } catch (e) {
        setLocalError((e as Error).message);
      }
    })();
  };

  if (awaitingEmailVerification) {
    return (
      <div className="feedback-form">
        <p className="ok-text">Account created for {awaitingEmailVerification.username}</p>
        <p className="muted small">
          We sent a verification link to <strong>{awaitingEmailVerification.email}</strong>. Open it to sign in
          and play. The link expires in 48 hours.
        </p>
        <div className="row">
          <button type="button" disabled={busy} onClick={resendVerification}>
            Resend verification email
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => switchMode("login")}>
            Back to sign in
          </button>
        </div>
        {statusMessage && <p className="banner info">{statusMessage}</p>}
        {localError && <p className="banner error">{localError}</p>}
      </div>
    );
  }

  return (
    <form className="feedback-form" onSubmit={onSubmit}>
      <div className="row">
        <button
          type="button"
          className={mode === "register" ? undefined : "secondary"}
          disabled={busy}
          onClick={() => switchMode("register")}
        >
          Create account
        </button>
        <button
          type="button"
          className={mode === "login" ? undefined : "secondary"}
          disabled={busy}
          onClick={() => switchMode("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === "reset" ? undefined : "secondary"}
          disabled={busy}
          onClick={() => switchMode("reset")}
        >
          Reset password
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
      {mode !== "reset" && (
        <PasswordField
          id="auth-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          disabled={busy}
        />
      )}
      {mode === "register" && (
        <>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <p className="muted small">
            Required. We email a verification link before you can sign in. Password resets go to this address.
          </p>
        </>
      )}
      {mode === "reset" && (
        <>
          <label htmlFor="auth-reset-email">Email on the account</label>
          <input
            id="auth-reset-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          {!resetEmailSent && (
            <p className="muted small">
              Enter your username and verified email. We will email a one-time reset code (15 minutes).
            </p>
          )}
          {resetEmailSent && (
            <p className="ok-text" role="status">
              If the account matches, check your email for the reset code, then enter it below.
            </p>
          )}
          <label htmlFor="auth-reset-code">Reset code from email</label>
          <input
            id="auth-reset-code"
            name="resetCode"
            autoComplete="one-time-code"
            required={resetEmailSent}
            value={resetCode}
            onChange={(e) => setResetCode(e.target.value)}
            disabled={busy}
            spellCheck={false}
          />
          <PasswordField
            id="auth-new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={busy}
            name="new-password"
          />
          <PasswordField
            id="auth-confirm-password"
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            disabled={busy}
            name="confirm-password"
          />
        </>
      )}
      {mode !== "reset" && (
        <div className="row">
          <button type="submit" disabled={busy}>
            {mode === "register" ? "Create account" : "Sign in"}
          </button>
          {mode === "login" && (
            <button type="button" className="linkish" disabled={busy} onClick={() => switchMode("reset")}>
              Forgot password?
            </button>
          )}
        </div>
      )}
      {mode === "reset" && (
        <div className="row">
          {!resetEmailSent ? (
            <button type="submit" disabled={busy || !username.trim() || !email.trim()}>
              Email reset code
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !resetCode.trim() || password.length < 8}
              onClick={submitNewPassword}
            >
              Set new password
            </button>
          )}
        </div>
      )}
      {localError && <p className="banner error">{localError}</p>}
      <p className="muted small">
        Play and redeem funded DAT with this account. Connect Sage later only if you want DAT in your wallet.
      </p>
    </form>
  );
}

export function ChangePasswordForm({
  busy,
  onChangePassword,
}: {
  busy: boolean;
  onChangePassword: (fields: { currentPassword: string; password: string }) => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(true)}>
        Change password
      </button>
    );
  }

  return (
    <form
      className="feedback-form"
      onSubmit={(event) => {
        event.preventDefault();
        setLocalError(null);
        if (password !== confirm) {
          setLocalError("New passwords do not match");
          return;
        }
        void (async () => {
          try {
            await onChangePassword({ currentPassword, password });
            setCurrentPassword("");
            setPassword("");
            setConfirm("");
            setOpen(false);
          } catch (e) {
            setLocalError((e as Error).message);
          }
        })();
      }}
    >
      <PasswordField
        id="change-current-password"
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        disabled={busy}
        name="current-password"
      />
      <PasswordField
        id="change-new-password"
        label="New password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        disabled={busy}
        name="new-password"
      />
      <PasswordField
        id="change-confirm-password"
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        disabled={busy}
        name="confirm-password"
      />
      {localError && <p className="banner error">{localError}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>
          Update password
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
