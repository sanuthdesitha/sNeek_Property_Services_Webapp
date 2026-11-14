"use client";

/**
 * Profile › Your PIN (administrators and operations managers).
 *
 * The person's OWN sensitive-action PIN: set, change or remove it with their
 * current password (GET/POST/DELETE /api/me/admin-pin). The PIN is never shown
 * again and nobody else can see it; an administrator can only clear it, which
 * this section says. Fields freeze while saving; a failed save keeps what was
 * typed except the password.
 */
import * as React from "react";
import { KeyRound } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { PIN_MAX_DIGITS, newPinProblem } from "@/lib/security/pin-rules";

type PinState = {
  hasPin: boolean;
  updatedAt: string | null;
  lockedUntil: string | null;
  resetByAdministrator: boolean;
};

type LoadState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; pin: PinState };

const INPUT =
  "mt-1 h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:text-[0.875rem] disabled:opacity-60";
const LABEL = "block text-[0.8125rem] font-[550]";

function digits(text: string) {
  return text.replace(/\D/g, "").slice(0, PIN_MAX_DIGITS);
}

function formatWhen(iso: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function OwnPinSection({ timeZone = "Australia/Sydney" }: { timeZone?: string }) {
  const id = React.useId();
  const [load, setLoad] = React.useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [form, setForm] = React.useState({ currentPassword: "", pin: "", confirmPin: "" });
  const [saving, setSaving] = React.useState<"save" | "remove" | null>(null);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/me/admin-pin", { cache: "no-store", signal: controller.signal });
        const body = (await res.json().catch(() => null)) as (PinState & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !body || typeof body.hasPin !== "boolean") {
          setLoad({ kind: "failed", message: body?.error ?? "Your PIN status could not be loaded." });
          return;
        }
        setLoad({ kind: "ready", pin: body });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed", message: "Your PIN status could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  async function send(method: "POST" | "DELETE") {
    setMessage(null);
    if (!form.currentPassword.trim()) {
      setMessage({ tone: "error", text: "Enter your current password." });
      return;
    }
    if (method === "POST") {
      const problem = newPinProblem(form.pin, form.confirmPin);
      if (problem) {
        setMessage({ tone: "error", text: problem });
        return;
      }
    }
    setSaving(method === "POST" ? "save" : "remove");
    try {
      const res = await fetch("/api/me/admin-pin", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "POST" ? { currentPassword: form.currentPassword, pin: form.pin } : { currentPassword: form.currentPassword }),
      });
      const body = (await res.json().catch(() => null)) as (PinState & { error?: string }) | null;
      if (!res.ok || !body || typeof body.hasPin !== "boolean") {
        setForm((prev) => ({ ...prev, currentPassword: "" }));
        setMessage({ tone: "error", text: body?.error ?? "Your PIN was not changed. Try again." });
        return;
      }
      const hadPin = load.kind === "ready" && load.pin.hasPin;
      setLoad({ kind: "ready", pin: body });
      setForm({ currentPassword: "", pin: "", confirmPin: "" });
      setMessage({ tone: "ok", text: method === "DELETE" ? "Your PIN was removed. Your next sensitive action asks you to set a new one." : hadPin ? "Your PIN was changed." : "Your PIN is set." });
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Your PIN was not changed." });
    } finally {
      setSaving(null);
    }
  }

  const busy = saving !== null;
  const pin = load.kind === "ready" ? load.pin : null;

  return (
    <ECard id="own-pin" className="scroll-mt-24">
      <ECardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-[1rem] font-semibold">Your PIN</h2>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              You confirm sensitive actions (deletes, resets, access changes, the Rate card) with your own PIN. Nobody else uses it and nobody can see it, not even an administrator. An administrator can only clear it so that you set a new one.
            </p>
          </div>
        </div>

        {load.kind === "loading" ? <p role="status" className="text-[0.8125rem]">Checking your PIN…</p> : null}
        {load.kind === "failed" ? (
          <div role="alert" className="space-y-2 text-[0.8125rem]">
            <p>{load.message}</p>
            <EButton size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Try again</EButton>
          </div>
        ) : null}
        {pin ? (
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem]">
            <p className="font-[550]">{pin.hasPin ? "Your PIN is set" : pin.resetByAdministrator ? "An administrator cleared your PIN" : "You have no PIN yet"}</p>
            <p className="text-[hsl(var(--e-muted-foreground))]">
              {pin.hasPin
                ? pin.updatedAt ? `Last set ${formatWhen(pin.updatedAt, timeZone)}.` : "When it was set is not recorded."
                : "Set it here, or at your next sensitive action with your account password."}
            </p>
            {pin.lockedUntil ? (
              <p className="mt-1 text-[hsl(var(--e-danger))]">Locked after too many wrong attempts until {formatWhen(pin.lockedUntil, timeZone)}.</p>
            ) : null}
          </div>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send("POST");
          }}
        >
          <fieldset disabled={busy || load.kind !== "ready"} className="space-y-3">
            <div>
              <label className={LABEL} htmlFor={`${id}-current`}>Current password</label>
              <input id={`${id}-current`} type="password" autoComplete="current-password" className={INPUT} value={form.currentPassword} onChange={(event) => setForm((prev) => ({ ...prev, currentPassword: event.target.value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor={`${id}-pin`}>{pin?.hasPin ? "New PIN" : "Your PIN"}</label>
                <input id={`${id}-pin`} type="password" inputMode="numeric" autoComplete="new-password" className={INPUT} value={form.pin} onChange={(event) => setForm((prev) => ({ ...prev, pin: digits(event.target.value) }))} />
              </div>
              <div>
                <label className={LABEL} htmlFor={`${id}-confirm`}>Confirm PIN</label>
                <input id={`${id}-confirm`} type="password" inputMode="numeric" autoComplete="new-password" className={INPUT} value={form.confirmPin} onChange={(event) => setForm((prev) => ({ ...prev, confirmPin: digits(event.target.value) }))} />
              </div>
            </div>
          </fieldset>
          {message ? (
            <p role={message.tone === "error" ? "alert" : "status"} className={`text-[0.8125rem] ${message.tone === "error" ? "text-[hsl(var(--e-danger))]" : ""}`}>{message.text}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {pin?.hasPin ? (
              <EButton type="button" variant="outline" disabled={busy} onClick={() => void send("DELETE")}>
                {saving === "remove" ? "Removing…" : "Remove PIN"}
              </EButton>
            ) : null}
            <EButton type="submit" disabled={busy || load.kind !== "ready"}>
              {saving === "save" ? "Saving…" : pin?.hasPin ? "Change PIN" : "Set PIN"}
            </EButton>
          </div>
        </form>
      </ECardBody>
    </ECard>
  );
}
