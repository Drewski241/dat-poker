import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api.js";
import { PLAY_COUNTRY_OPTIONS } from "./play-countries.js";
import { TurnstileWidget } from "./components/TurnstileWidget.js";

export type PlayComplianceInput = {
  countryCode: string;
  ageConfirmed: boolean;
  turnstileToken?: string;
  termsAccepted: boolean;
  termsVersion: string;
};

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
  onAddEmail,
  verificationPending,
  apiError,
}: {
  busy: boolean;
  apiError?: string | null;
  verificationPending?: { username: string; email: string } | null;
  onAuth: (
    mode: "register" | "login",
    fields: { username: string; password: string; email?: string } & PlayComplianceInput,
  ) => void;
  onVerifyEmail: (fields: { username: string; code: string } & PlayComplianceInput) => Promise<void>;
  onResendVerification: (fields: { username: string; email: string }) => Promise<{ message: string }>;
  onAddEmail: (
    fields: { username: string; password: string; email: string } & PlayComplianceInput,
  ) => Promise<void>;
  onForgot: (fields: { username: string; email: string }) => Promise<{
    message: string;
  }>;
  onReset: (fields: { username: string; resetCode: string; password: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<"register" | "login" | "verify" | "reset" | "add-email">(
    "register",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localInfo, setLocalInfo] = useState<string | null>(null);
  const [complianceRequired, setComplianceRequired] = useState(false);
  const [minAge, setMinAge] = useState(18);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [termsVersion, setTermsVersion] = useState("");
  const [termsContent, setTermsContent] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsLoadError, setTermsLoadError] = useState<string | null>(null);

  const loadAuthMeta = useCallback(() => {
    setTermsLoadError(null);
    void (async () => {
      try {
        const [req, geo, terms] = await Promise.all([
          api.playRequirements(),
          api.geoHint(),
          api.terms(),
        ]);
        setTermsVersion(terms.version);
        setTermsContent(terms.content);
        setComplianceRequired(req.complianceRequired);
        setMinAge(req.minAge);
        setTurnstileSiteKey(req.turnstileSiteKey);
        if (geo.countryCode && PLAY_COUNTRY_OPTIONS.some((c) => c.code === geo.countryCode)) {
          setCountryCode(geo.countryCode);
        }
      } catch {
        setTermsLoadError("Could not load terms or eligibility settings. Check API status and try again.");
      }
    })();
  }, []);

  useEffect(() => {
    loadAuthMeta();
  }, [loadAuthMeta]);

  const onTurnstileExpire = useCallback(() => setTurnstileToken(null), []);

  const buildCompliance = (): PlayComplianceInput | null => {
    if (!termsVersion) {
      setLocalError("Terms are still loading — try again in a moment");
      return null;
    }
    if (!termsAccepted) {
      setLocalError("Accept the Terms and Conditions to continue");
      return null;
    }
    if (!complianceRequired) {
      return {
        countryCode: countryCode || "US",
        ageConfirmed: true,
        termsAccepted: true,
        termsVersion,
      };
    }
    if (!countryCode) {
      setLocalError("Select the country where you are located");
      return null;
    }
    if (!ageConfirmed) {
      setLocalError(`Confirm you are at least ${minAge} and allowed to play where you live`);
      return null;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setLocalError("Complete the bot check");
      return null;
    }
    return {
      countryCode,
      ageConfirmed: true,
      turnstileToken: turnstileToken ?? undefined,
      termsAccepted: true,
      termsVersion,
    };
  };

  useEffect(() => {
    if (!verificationPending) return;
    setUsername(verificationPending.username);
    setEmail(verificationPending.email);
    setMode("verify");
    setLocalInfo("Check your email for a verification code.");
  }, [verificationPending]);

  const switchMode = (next: "register" | "login" | "verify" | "reset" | "add-email") => {
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
      const compliance = buildCompliance();
      if (!compliance) return;
      void (async () => {
        try {
          await onVerifyEmail({
            username: username.trim(),
            code: verifyCode.trim(),
            ...compliance,
          });
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
    if (mode === "add-email") {
      if (!email.trim()) {
        setLocalError("Email is required");
        return;
      }
      const compliance = buildCompliance();
      if (!compliance) return;
      void onAddEmail({
        username: username.trim(),
        password,
        email: email.trim(),
        ...compliance,
      }).then(() => {
        setVerifyCode("");
        setMode("verify");
        setLocalInfo("Verification code sent. Enter it below to finish signing in.");
      });
      return;
    }
    if (mode === "register" && !email.trim()) {
      setLocalError("Email is required");
      return;
    }
    const compliance = buildCompliance();
    if (!compliance) return;
    onAuth(mode, {
      username: username.trim(),
      password,
      email: email.trim() || undefined,
      ...compliance,
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
          Register
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
      {(mode === "register" ||
        mode === "login" ||
        mode === "verify" ||
        mode === "add-email") &&
        complianceRequired && (
        <fieldset className="compliance-fieldset">
          <legend>Eligibility</legend>
          <label htmlFor="auth-country">Country (where you are now)</label>
          <select
            id="auth-country"
            name="countryCode"
            required
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            disabled={busy}
          >
            {PLAY_COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              disabled={busy}
            />
            I am at least {minAge}, not a bot, and I am legally allowed to play real-money poker where I
            am located.
          </label>
          {turnstileSiteKey && (
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              disabled={busy}
              onToken={setTurnstileToken}
              onExpire={onTurnstileExpire}
            />
          )}
        </fieldset>
      )}
      {(mode === "register" || mode === "login" || mode === "verify" || mode === "add-email") && (
        <fieldset className="compliance-fieldset">
          <legend>Terms and Conditions</legend>
          {!termsVersion ? (
            <>
              <p className="muted small">Loading terms…</p>
              {termsLoadError && (
                <div className="row">
                  <p className="banner error">{termsLoadError}</p>
                  <button type="button" className="secondary" disabled={busy} onClick={loadAuthMeta}>
                    Retry
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="row">
                <button type="button" className="linkish" disabled={busy} onClick={() => setTermsOpen((o) => !o)}>
                  {termsOpen ? "Hide" : "View"} full terms (v{termsVersion})
                </button>
              </div>
              {termsOpen && (
                <pre className="terms-preview" aria-label="Terms and Conditions">
                  {termsContent}
                </pre>
              )}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  disabled={busy}
                />
                I have read and accept the Terms and Conditions (version {termsVersion}). Your acceptance is kept on
                file and must be renewed when terms change or after the retention period.
              </label>
            </>
          )}
        </fieldset>
      )}
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
          autoComplete={mode === "login" || mode === "add-email" ? "current-password" : "new-password"}
          disabled={busy}
        />
      )}
      {(mode === "register" || mode === "add-email") && (
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
            {mode === "add-email"
              ? "Proves you own this pre-email account. We email a verification code before you can sign in."
              : "Required for every account. We email a verification code before you can sign in."}
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
            {mode === "register"
              ? "Create account"
              : mode === "add-email"
                ? "Add email & send code"
                : "Sign in"}
          </button>
          {mode === "login" && (
            <>
              <button type="button" className="linkish" disabled={busy} onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
              <button type="button" className="linkish" disabled={busy} onClick={() => switchMode("verify")}>
                Verify email
              </button>
              <button type="button" className="linkish" disabled={busy} onClick={() => switchMode("add-email")}>
                Add email (older account)
              </button>
            </>
          )}
        </div>
      )}
      {mode === "add-email" && (
        <p className="muted small">
          For accounts created before email was required. You need your username and password, then we verify the
          new address.
        </p>
      )}
      {localInfo && <p className="banner info">{localInfo}</p>}
      {apiError && <p className="banner error">{apiError}</p>}
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
