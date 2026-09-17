import { useEffect, useState, type FormEvent } from "react";

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
  onVerifyEmail,
  onResendVerification,
  onForgot,
  onReset,
  verificationPending,
}: {
  busy: boolean;
  verificationPending?: { username: string; email: string } | null;
  onAuth: (mode: "register" | "login", fields: { username: string; password: string; email?: string }) => void;
  onVerifyEmail: (fields: { username: string; code: string }) => Promise<void>;
  onResendVerification: (fields: { username: string; email: string }) => Promise<{ message: string }>;
  onForgot: (fields: { username: string; email: string }) => Promise<{
    message: string;
  }>;
  onReset: (fields: { username: string; resetCode: string; password: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<"register" | "login" | "verify" | "reset">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localInfo, setLocalInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!verificationPending) return;
    setUsername(verificationPending.username);
    setEmail(verificationPending.email);
    setMode("verify");
    setLocalInfo("Check your email for a verification code.");
  }, [verificationPending]);

  const switchMode = (next: "register" | "login" | "verify" | "reset") => {
    setMode(next);
    setPassword("");
    setConfirm("");
    setResetCode("");
    setVerifyCode("");
    setResetEmailSent(false);
    setLocalError(null);
    setLocalInfo(null);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (mode === "verify") {
      setLocalError(null);
      void (async () => {
        try {
          await onVerifyEmail({ username: username.trim(), code: verifyCode.trim() });
        } catch (e) {
          setLocalError((e as Error).message);
        }
      })();
      return;
    }
    if (mode === "reset") {
      if (resetEmailSent && resetCode.trim()) submitNewPassword();
      else if (!resetEmailSent) requestResetEmail();
      return;
    }
    if (mode === "register" && !email.trim()) {
      setLocalError("Email is required");
      return;
    }
    onAuth(mode, {
      username: username.trim(),
      password,
      email: email.trim() || undefined,
    });
  };

  const requestResetEmail = () => {
    setLocalError(null);
    setLocalInfo(null);
    void (async () => {
      try {
        const result = await onForgot({ username: username.trim(), email: email.trim() });
        setResetEmailSent(true);
        setLocalInfo(result.message);
      } catch (e) {
        setLocalError((e as Error).message);
      }
    })();
  };

  const resendVerification = () => {
    setLocalError(null);
    setLocalInfo(null);
    void (async () => {
      try {
        const result = await onResendVerification({ username: username.trim(), email: email.trim() });
        setLocalInfo(result.message);
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
      {mode !== "reset" && mode !== "verify" && (
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
            Required for every account. We email a verification code before you can sign in.
          </p>
        </>
      )}
      {mode === "verify" && (
        <>
          <p className="muted small">
            Enter the verification code we sent to <strong>{email || "your email"}</strong>.
          </p>
          <label htmlFor="auth-verify-code">Verification code</label>
          <input
            id="auth-verify-code"
            name="verifyCode"
            autoComplete="one-time-code"
            required
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value)}
            disabled={busy}
            spellCheck={false}
          />
          <div className="row">
            <button type="submit" disabled={busy || !verifyCode.trim()}>
              Verify email
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !username.trim() || !email.trim()}
              onClick={resendVerification}
            >
              Resend code
            </button>
          </div>
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
          <div className="row">
            <button
              type="button"
              disabled={busy || resetEmailSent || !username.trim() || !email.trim()}
              onClick={requestResetEmail}
            >
              Email reset code
            </button>
          </div>
          {resetEmailSent && (
            <p className="muted small" role="status">
              Check your inbox for the reset code (expires in 15 minutes), then enter it below.
            </p>
          )}
          {!resetEmailSent && (
            <p className="muted small">
              Use the verified email on your account. Reset codes are only sent by email.
            </p>
          )}
          <label htmlFor="auth-reset-code">Reset code</label>
          <input
            id="auth-reset-code"
            name="resetCode"
            autoComplete="one-time-code"
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
          <div className="row">
            <button
              type="button"
              disabled={busy || !resetCode.trim() || password.length < 8}
              onClick={submitNewPassword}
            >
              Set new password
            </button>
          </div>
        </>
      )}
      {mode !== "reset" && mode !== "verify" && (
        <div className="row">
          <button type="submit" disabled={busy}>
            {mode === "register" ? "Create account" : "Sign in"}
          </button>
          {mode === "login" && (
            <>
              <button type="button" className="linkish" disabled={busy} onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
              <button type="button" className="linkish" disabled={busy} onClick={() => switchMode("verify")}>
                Verify email
              </button>
            </>
          )}
        </div>
      )}
      {localInfo && <p className="banner info">{localInfo}</p>}
      {localError && <p className="banner error">{localError}</p>}
      <p className="muted small">
        Play and redeem funded DAT with this account. Connect Sage later only if you
        want DAT in your wallet.
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
