"use client";

/**
 * THE ONE CREDENTIAL FIELD of every sensitive (tier C) confirmation
 * (board "Confirmations and deletes", 2026-11-14).
 *
 * Always the person actually signed in, never the account being tested. One
 * field, five states:
 *   - has a PIN:        "Your PIN" (number pad on phones, paste allowed, Show);
 *   - wrong PIN:        "That PIN is not right. 3 tries left." after a refusal;
 *   - locked:           "Locked", "Too many wrong tries. Try again at 14:52.";
 *   - no PIN yet:       "Your password", "Your password, this time. Set a PIN
 *                       so next time is 4 digits." with a link to the profile
 *                       (owner default 2026-11-14, pending owner confirmation:
 *                       the password alone confirms while someone has no PIN);
 *   - testing as someone else: "Not available", "Stop testing as … to do this.
 *                       It needs your own PIN." No credential can be sent.
 * While the state is loading or could not be read the field asks for the PIN
 * and offers "I have no PIN yet" to switch to the password.
 *
 * The state comes from GET /api/me/admin-pin (never the PIN itself) and is
 * read again after a refusal (`refresh`), which is how the field learns the
 * tries left or the lock. The server still decides: this field only collects.
 * Plain inputs (no estate-kit import) so both the Estate and the classic
 * prompts can use it.
 */
import * as React from "react";
import { PIN_LOCK_THRESHOLD, PIN_MAX_DIGITS, PIN_MIN_DIGITS, type SensitiveCredentialsInput } from "@/lib/security/pin-rules";

export type OwnPinStatus = "loading" | "has-pin" | "needs-setup" | "unavailable" | "testing";

/** `newPin` / `confirmPin` are kept for older callers; the field no longer asks for them. */
export type OwnPinValue = { pin: string; password: string; newPin: string; confirmPin: string };

export const EMPTY_OWN_PIN: OwnPinValue = { pin: "", password: "", newPin: "", confirmPin: "" };

/** Where a person sets or changes their own PIN (with their password). */
export const SET_PIN_HREF = "/v2/admin/profile#own-pin";

type OwnPinStateBody = { hasPin?: boolean; lockedUntil?: string | null; userId?: string; attemptsLeft?: number; timezone?: string; code?: string };

export type OwnPinStatusState = {
  status: OwnPinStatus;
  lockedUntil: string | null;
  userId: string | null;
  /** Wrong tries left before the lock; null when not known. */
  attemptsLeft: number | null;
  /** The organisation timezone the lock time is shown in. */
  timezone: string;
};

const DEFAULT_TIMEZONE = "Australia/Sydney";
const LOADING_STATE: OwnPinStatusState = { status: "loading", lockedUntil: null, userId: null, attemptsLeft: null, timezone: DEFAULT_TIMEZONE };
const UNAVAILABLE_STATE: OwnPinStatusState = { status: "unavailable", lockedUntil: null, userId: null, attemptsLeft: null, timezone: DEFAULT_TIMEZONE };

function stateFromBody(ok: boolean, body: OwnPinStateBody | null): OwnPinStatusState {
  if (!ok && body?.code === "ACTUAL_ACTOR_REQUIRED") return { ...UNAVAILABLE_STATE, status: "testing" };
  if (!ok || !body || typeof body.hasPin !== "boolean") return UNAVAILABLE_STATE;
  return {
    status: body.hasPin ? "has-pin" : "needs-setup",
    lockedUntil: body.lockedUntil ?? null,
    userId: body.userId ?? null,
    attemptsLeft: typeof body.attemptsLeft === "number" ? body.attemptsLeft : null,
    timezone: typeof body.timezone === "string" && body.timezone ? body.timezone : DEFAULT_TIMEZONE,
  };
}

/**
 * Reads the signed-in person's PIN state while `active`; `refresh()` reads it
 * again (after a refusal). A read that is no longer wanted is aborted, and the
 * last good state stays on screen while a refresh runs.
 */
export function useOwnPinStatus(active: boolean): OwnPinStatusState & { refresh: () => void } {
  const [state, setState] = React.useState<OwnPinStatusState>(LOADING_STATE);
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    if (nonce === 0) setState(LOADING_STATE);
    void (async () => {
      try {
        const res = await fetch("/api/me/admin-pin", { cache: "no-store", signal: controller.signal });
        const body = (await res.json().catch(() => null)) as OwnPinStateBody | null;
        if (controller.signal.aborted) return;
        setState(stateFromBody(res.ok, body));
      } catch {
        if (!controller.signal.aborted) setState(UNAVAILABLE_STATE);
      }
    })();
    return () => controller.abort();
  }, [active, nonce]);
  React.useEffect(() => {
    if (!active) setNonce(0);
  }, [active]);
  const refresh = React.useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, refresh };
}

/** Which field the prompt shows: the person's own choice (null = none yet) wins over the loaded state. */
export function ownPinMode(status: OwnPinStatus, settingUp: boolean | null): "pin" | "setup" {
  if (settingUp !== null) return settingUp ? "setup" : "pin";
  return status === "needs-setup" ? "setup" : "pin";
}

function isLockedNow(lockedUntil: string | null | undefined): boolean {
  return Boolean(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
}

/**
 * The credentials to send, or a reason the prompt cannot be sent yet.
 * Never mixes a PIN with a password: the server accepts one or the other.
 * "setup" mode (no PIN yet) sends the account password alone.
 */
export function ownPinCredentials(value: OwnPinValue, mode: "pin" | "setup"): { credentials: SensitiveCredentialsInput } | { problem: string } {
  if (mode === "pin") {
    const pin = value.pin.trim();
    return pin ? { credentials: { pin } } : { problem: "Enter your PIN." };
  }
  return value.password.trim() ? { credentials: { password: value.password } } : { problem: "Enter your account password." };
}

const INPUT =
  "h-11 w-full min-w-0 rounded-md border border-[hsl(var(--e-input,var(--input)))] bg-transparent px-3 text-[16px] sm:text-sm disabled:opacity-60 " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring,var(--ring)))]";
const LABEL = "block text-sm font-medium";
const NOTE = "text-xs text-[hsl(var(--e-muted-foreground,var(--muted-foreground)))]";
const PROBLEM = "text-xs font-medium text-[hsl(var(--e-danger,var(--destructive)))]";
const SHOW =
  "absolute inset-y-0 right-0 min-w-14 rounded-r-md px-3 text-xs font-medium text-[hsl(var(--e-muted-foreground,var(--muted-foreground)))] hover:text-[hsl(var(--e-foreground,var(--foreground)))] disabled:opacity-50";

function digitsOnly(text: string) {
  return text.replace(/\D/g, "").slice(0, PIN_MAX_DIGITS);
}

/** A clock time in the organisation timezone ("14:52"). */
function timeOf(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-AU", { timeZone: DEFAULT_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  }
}

/** On a phone, keep the field above the keyboard once it opens. */
function keepVisible(event: React.FocusEvent<HTMLInputElement>) {
  const target = event.currentTarget;
  window.setTimeout(() => {
    if (document.activeElement === target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  }, 250);
}

export type OwnPinFieldsProps = {
  status: OwnPinStatus;
  lockedUntil?: string | null;
  attemptsLeft?: number | null;
  /** The organisation timezone for the lock time. */
  timezone?: string;
  /** True after the server refused the last credential (wrong PIN or password). */
  refused?: boolean;
  value: OwnPinValue;
  onChange: (next: OwnPinValue) => void;
  settingUp: boolean | null;
  onSettingUpChange: (next: boolean) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Enter in the field: lets the dialog confirm. */
  onSubmit?: () => void;
  /** Who the person is testing as, when known ("Stop testing as Chloe Martin"). */
  testingAsName?: string | null;
};

export function OwnPinFields({
  status,
  lockedUntil,
  attemptsLeft = null,
  timezone = DEFAULT_TIMEZONE,
  refused = false,
  value,
  onChange,
  settingUp,
  onSettingUpChange,
  disabled = false,
  autoFocus = false,
  onSubmit,
  testingAsName = null,
}: OwnPinFieldsProps) {
  const id = React.useId();
  const [shown, setShown] = React.useState(false);
  const mode = ownPinMode(status, settingUp);
  const set = (patch: Partial<OwnPinValue>) => onChange({ ...value, ...patch });
  const helpId = `${id}-help`;
  const inputId = `${id}-credential`;

  if (status === "testing") {
    return (
      <div className="space-y-1">
        <label className={LABEL} htmlFor={inputId}>Your PIN</label>
        <input id={inputId} className={INPUT} value="Not available" disabled readOnly aria-describedby={helpId} />
        <p id={helpId} role="alert" className={PROBLEM}>
          Stop testing as {testingAsName ?? "someone else"} to do this. It needs your own PIN.
        </p>
      </div>
    );
  }

  if (isLockedNow(lockedUntil)) {
    return (
      <div className="space-y-1">
        <label className={LABEL} htmlFor={inputId}>{mode === "pin" ? "Your PIN" : "Your password"}</label>
        <input id={inputId} className={INPUT} value="Locked" disabled readOnly aria-describedby={helpId} />
        <p id={helpId} role="alert" className={PROBLEM}>
          Too many wrong tries. Try again at {timeOf(lockedUntil!, timezone)}.
        </p>
        <p className={NOTE}>The button stays off until then.</p>
      </div>
    );
  }

  const triesLeft = attemptsLeft ?? PIN_LOCK_THRESHOLD;
  const wrongLine = refused
    ? `${mode === "pin" ? "That PIN is not right." : "That password is not right."} ${triesLeft === 1 ? "1 try left." : `${triesLeft} tries left.`}`
    : null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && onSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  if (mode === "pin") {
    return (
      <div className="space-y-1">
        <label className={LABEL} htmlFor={inputId}>Your PIN</label>
        <div className="relative">
          <input
            id={inputId}
            type={shown ? "text" : "password"}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            autoFocus={autoFocus}
            aria-invalid={refused || undefined}
            aria-describedby={helpId}
            maxLength={PIN_MAX_DIGITS}
            className={`${INPUT} pr-16 tracking-[0.2em]`}
            value={value.pin}
            disabled={disabled}
            onFocus={keepVisible}
            onKeyDown={onKeyDown}
            onChange={(event) => set({ pin: digitsOnly(event.target.value) })}
          />
          <button type="button" className={SHOW} disabled={disabled} aria-pressed={shown} aria-label={shown ? "Hide PIN" : "Show PIN"} onClick={() => setShown((prev) => !prev)}>
            {shown ? "Hide" : "Show"}
          </button>
        </div>
        <div id={helpId} className="space-y-0.5">
          {wrongLine ? <p role="alert" className={PROBLEM}>{wrongLine}</p> : null}
          {status === "loading" ? <p className={NOTE} role="status">Checking your PIN…</p> : null}
          <p className={NOTE}>
            {PIN_MIN_DIGITS} to {PIN_MAX_DIGITS} digits, your own. Forgot it?{" "}
            <a className="underline" href={SET_PIN_HREF}>Change your PIN</a> in your profile with your password.
          </p>
        </div>
        {status !== "has-pin" || settingUp === false ? (
          <button type="button" className="min-h-11 text-sm underline" disabled={disabled} onClick={() => onSettingUpChange(true)}>
            I have no PIN yet
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor={inputId}>Your password</label>
      <div className="relative">
        <input
          id={inputId}
          type={shown ? "text" : "password"}
          autoComplete="current-password"
          enterKeyHint="done"
          autoFocus={autoFocus}
          aria-invalid={refused || undefined}
          aria-describedby={helpId}
          className={`${INPUT} pr-16`}
          value={value.password}
          disabled={disabled}
          onFocus={keepVisible}
          onKeyDown={onKeyDown}
          onChange={(event) => set({ password: event.target.value })}
        />
        <button type="button" className={SHOW} disabled={disabled} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"} onClick={() => setShown((prev) => !prev)}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      <div id={helpId} className="space-y-0.5">
        {wrongLine ? <p role="alert" className={PROBLEM}>{wrongLine}</p> : null}
        <p className={NOTE}>
          You have no PIN yet, so your account password confirms this time.{" "}
          <a className="underline" href={SET_PIN_HREF}>Set a PIN</a> so next time is {PIN_MIN_DIGITS} digits.
        </p>
      </div>
      {status !== "needs-setup" ? (
        <button type="button" className="min-h-11 text-sm underline" disabled={disabled} onClick={() => onSettingUpChange(false)}>
          I already have a PIN
        </button>
      ) : null}
    </div>
  );
}

/**
 * Everything a prompt needs in one hook: the loaded state, the value (kept
 * while open, cleared when closed), the credentials to send, and
 * `noteRefusal()` to call after the server refused, which clears the typed
 * credential and reads the tries left / the lock again.
 */
export function useOwnPinPrompt(open: boolean) {
  const { status, lockedUntil, userId, attemptsLeft, timezone, refresh } = useOwnPinStatus(open);
  const [value, setValue] = React.useState<OwnPinValue>(EMPTY_OWN_PIN);
  const [settingUp, setSettingUp] = React.useState<boolean | null>(null);
  const [refused, setRefused] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setValue(EMPTY_OWN_PIN);
      setSettingUp(null);
      setRefused(false);
    }
  }, [open]);
  const change = React.useCallback((next: OwnPinValue) => {
    setValue(next);
    setRefused(false);
  }, []);
  const mode = ownPinMode(status, settingUp);
  const locked = isLockedNow(lockedUntil);
  const result = status === "testing" || locked ? { problem: status === "testing" ? "Stop testing as someone else first." : "Locked." } : ownPinCredentials(value, mode);
  const noteRefusal = React.useCallback(() => {
    setValue(EMPTY_OWN_PIN);
    setRefused(true);
    refresh();
  }, [refresh]);
  // After a failure whose cause is not known (the caller showed its own
  // message): clear the credential, read the state again, and show the
  // wrong-credential line only if the server counted a wrong try.
  const triesBefore = React.useRef<number | null>(null);
  const noteFailure = React.useCallback(() => {
    triesBefore.current = attemptsLeft ?? PIN_LOCK_THRESHOLD;
    setValue(EMPTY_OWN_PIN);
    refresh();
  }, [attemptsLeft, refresh]);
  React.useEffect(() => {
    const before = triesBefore.current;
    if (before === null) return;
    if (locked || (attemptsLeft !== null && attemptsLeft < before)) {
      triesBefore.current = null;
      setRefused(true);
    }
  }, [attemptsLeft, locked]);
  return {
    fieldProps: { status, lockedUntil, attemptsLeft, timezone, refused, value, onChange: change, settingUp, onSettingUpChange: setSettingUp },
    userId,
    status,
    attemptsLeft,
    locked,
    credentials: "credentials" in result ? result.credentials : null,
    problem: "problem" in result ? result.problem : null,
    reset: () => setValue(EMPTY_OWN_PIN),
    refresh,
    noteRefusal,
    noteFailure,
  };
}
