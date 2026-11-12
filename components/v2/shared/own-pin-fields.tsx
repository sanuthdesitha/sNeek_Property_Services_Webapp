"use client";

/**
 * The PIN part of every sensitive-action prompt: the person's OWN PIN.
 *
 * - With a PIN: one field, "Your PIN".
 * - With no PIN yet (never set, or cleared by an administrator): "You have no
 *   PIN yet", their account password once, and the PIN to set (twice). The
 *   server checks the password, stores the PIN and confirms the action.
 * - While the state is loading or could not be read: "Your PIN", with
 *   "I have no PIN yet" to switch to setting one.
 *
 * The state comes from GET /api/me/admin-pin (never the PIN itself). Values are
 * kept while the prompt is open and cleared by the owner when it closes.
 * Plain inputs (no estate-kit import) so both the Estate and the classic
 * prompts can use it.
 */
import * as React from "react";
import { PIN_MAX_DIGITS, newPinProblem, type SensitiveCredentialsInput } from "@/lib/security/pin-rules";

export type OwnPinStatus = "loading" | "has-pin" | "needs-setup" | "unavailable";

export type OwnPinValue = { pin: string; password: string; newPin: string; confirmPin: string };

export const EMPTY_OWN_PIN: OwnPinValue = { pin: "", password: "", newPin: "", confirmPin: "" };

type OwnPinStateBody = { hasPin?: boolean; lockedUntil?: string | null; userId?: string };

/** Reads the signed-in person's PIN state while `active`; aborts a read that is no longer wanted. */
export type OwnPinStatusState = { status: OwnPinStatus; lockedUntil: string | null; userId: string | null };

export function useOwnPinStatus(active: boolean): OwnPinStatusState {
  const [state, setState] = React.useState<OwnPinStatusState>({ status: "loading", lockedUntil: null, userId: null });
  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setState({ status: "loading", lockedUntil: null, userId: null });
    void (async () => {
      try {
        const res = await fetch("/api/me/admin-pin", { cache: "no-store", signal: controller.signal });
        const body = (await res.json().catch(() => null)) as OwnPinStateBody | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !body || typeof body.hasPin !== "boolean") {
          setState({ status: "unavailable", lockedUntil: null, userId: null });
          return;
        }
        setState({ status: body.hasPin ? "has-pin" : "needs-setup", lockedUntil: body.lockedUntil ?? null, userId: body.userId ?? null });
      } catch {
        if (!controller.signal.aborted) setState({ status: "unavailable", lockedUntil: null, userId: null });
      }
    })();
    return () => controller.abort();
  }, [active]);
  return state;
}

/** Which fields the prompt shows: the person's own choice (null = none yet) wins over the loaded state. */
export function ownPinMode(status: OwnPinStatus, settingUp: boolean | null): "pin" | "setup" {
  if (settingUp !== null) return settingUp ? "setup" : "pin";
  return status === "needs-setup" ? "setup" : "pin";
}

/**
 * The credentials to send, or a reason the prompt cannot be sent yet.
 * Never mixes a PIN with a password: the server accepts one or the other.
 */
export function ownPinCredentials(value: OwnPinValue, mode: "pin" | "setup"): { credentials: SensitiveCredentialsInput } | { problem: string } {
  if (mode === "pin") {
    const pin = value.pin.trim();
    return pin ? { credentials: { pin } } : { problem: "Enter your PIN." };
  }
  if (!value.password.trim()) return { problem: "Enter your account password." };
  const problem = newPinProblem(value.newPin.trim(), value.confirmPin.trim());
  if (problem) return { problem };
  return { credentials: { password: value.password, newPin: value.newPin.trim() } };
}

const INPUT =
  "mt-1 h-11 w-full rounded-md border border-[hsl(var(--e-input,var(--input)))] bg-transparent px-3 text-[16px] sm:text-sm disabled:opacity-60";
const LABEL = "block text-sm font-medium";
const NOTE = "text-xs text-[hsl(var(--e-muted-foreground,var(--muted-foreground)))]";

function digitsOnly(text: string) {
  return text.replace(/\D/g, "").slice(0, PIN_MAX_DIGITS);
}

export function OwnPinFields({
  status,
  lockedUntil,
  value,
  onChange,
  settingUp,
  onSettingUpChange,
  disabled = false,
  autoFocus = false,
}: {
  status: OwnPinStatus;
  lockedUntil?: string | null;
  value: OwnPinValue;
  onChange: (next: OwnPinValue) => void;
  settingUp: boolean | null;
  onSettingUpChange: (next: boolean) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = React.useId();
  const mode = ownPinMode(status, settingUp);
  const set = (patch: Partial<OwnPinValue>) => onChange({ ...value, ...patch });
  const locked = lockedUntil ? new Date(lockedUntil) : null;

  return (
    <div className="space-y-3">
      {locked && locked.getTime() > Date.now() ? (
        <p role="alert" className="text-sm text-[hsl(var(--e-danger,var(--destructive)))]">
          Too many wrong attempts. Try again after {locked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, or ask an administrator to reset your PIN.
        </p>
      ) : null}
      {status === "loading" ? <p className={NOTE} role="status">Checking your PIN…</p> : null}
      {mode === "pin" ? (
        <div>
          <label className={LABEL} htmlFor={`${id}-pin`}>Your PIN</label>
          <input
            id={`${id}-pin`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={autoFocus}
            className={INPUT}
            value={value.pin}
            disabled={disabled}
            onChange={(event) => set({ pin: digitsOnly(event.target.value) })}
          />
          <p className={NOTE}>Your own PIN, not anyone else&apos;s.</p>
          {status !== "has-pin" || settingUp === false ? (
            <button type="button" className="mt-1 min-h-11 text-sm underline" disabled={disabled} onClick={() => onSettingUpChange(true)}>
              I have no PIN yet
            </button>
          ) : null}
        </div>
      ) : (
        <fieldset className="space-y-3" disabled={disabled}>
          <legend className="text-sm font-medium">Set your own PIN</legend>
          <p className={NOTE}>You have no PIN yet. Enter your account password once and choose your PIN. From then on you confirm with your PIN.</p>
          <div>
            <label className={LABEL} htmlFor={`${id}-password`}>Account password</label>
            <input id={`${id}-password`} type="password" autoComplete="current-password" autoFocus={autoFocus} className={INPUT} value={value.password} onChange={(event) => set({ password: event.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor={`${id}-new`}>Choose your PIN</label>
              <input id={`${id}-new`} type="password" inputMode="numeric" autoComplete="new-password" className={INPUT} value={value.newPin} onChange={(event) => set({ newPin: digitsOnly(event.target.value) })} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${id}-confirm`}>Confirm your PIN</label>
              <input id={`${id}-confirm`} type="password" inputMode="numeric" autoComplete="new-password" className={INPUT} value={value.confirmPin} onChange={(event) => set({ confirmPin: digitsOnly(event.target.value) })} />
            </div>
          </div>
          <button type="button" className="min-h-11 text-sm underline" onClick={() => onSettingUpChange(false)}>
            I already have a PIN
          </button>
        </fieldset>
      )}
    </div>
  );
}

/**
 * Everything a prompt needs in one hook: the loaded state, the values (kept
 * while open, cleared when closed) and the credentials to send.
 */
export function useOwnPinPrompt(open: boolean) {
  const { status, lockedUntil, userId } = useOwnPinStatus(open);
  const [value, setValue] = React.useState<OwnPinValue>(EMPTY_OWN_PIN);
  const [settingUp, setSettingUp] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!open) {
      setValue(EMPTY_OWN_PIN);
      setSettingUp(null);
    }
  }, [open]);
  const mode = ownPinMode(status, settingUp);
  const result = ownPinCredentials(value, mode);
  return {
    fieldProps: { status, lockedUntil, value, onChange: setValue, settingUp, onSettingUpChange: setSettingUp },
    userId,
    credentials: "credentials" in result ? result.credentials : null,
    problem: "problem" in result ? result.problem : null,
    reset: () => setValue(EMPTY_OWN_PIN),
  };
}
