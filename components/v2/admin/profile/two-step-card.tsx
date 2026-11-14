"use client";

/**
 * Your profile › Two-step sign-in. Status, set up (authenticator app or email
 * code), switch method and turn off, against /api/auth/2fa/settings (the
 * signed-in person only; refused while testing as someone else).
 *
 * Switching method runs the new method's setup first, so nobody is left
 * without one: two-step stays on with the old method until the new code is
 * confirmed. Turning off asks for the password. Backup codes are shown in full
 * only once, when they are created.
 *
 * Requirement (lib/auth/two-step-policy.ts): administrators must turn it on;
 * the card names the grace deadline, or says it is now needed before other
 * admin pages open. Operations managers see it suggested.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { PROFILE_HINT, PROFILE_INPUT, PROFILE_LABEL, ProfileCard, ProfileMessage, type CardState } from "./profile-card";

type Method = "TOTP" | "EMAIL";

type Requirement =
  | { kind: "not_applicable" }
  | { kind: "met"; required: boolean }
  | { kind: "suggested" }
  | { kind: "grace"; deadline: string | null }
  | { kind: "setup_required"; since: string };

type Status = {
  enabled: boolean;
  method: Method | null;
  backupCodesRemaining: number;
  hasPassword: boolean;
  email: string | null;
  requirement?: Requirement;
};

type Load = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; status: Status };
type Setup = { phase: "idle" } | { phase: "totp"; qr: string; secret: string } | { phase: "email" };
type Message = { tone: "ok" | "error"; text: string } | null;

const METHOD_WORD: Record<Method, string> = { TOTP: "authenticator app", EMAIL: "email code" };

function formatDeadline(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function TwoStepCard({ timeZone, readOnlyReason, prompted }: { timeZone: string; readOnlyReason: string | null; prompted: boolean }) {
  const id = React.useId();
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [setup, setSetup] = React.useState<Setup>({ phase: "idle" });
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showTurnOff, setShowTurnOff] = React.useState(false);
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/auth/2fa/settings", { cache: "no-store", signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !body) return setLoad({ kind: "failed", message: "Your two-step status could not be loaded." });
        setLoad({ kind: "ready", status: body as Status });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed", message: "Your two-step status could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  // Opened from the sign-in prompt (?setup=two-step): bring the card into view.
  React.useEffect(() => {
    if (prompted) cardRef.current?.scrollIntoView({ block: "start" });
  }, [prompted]);

  async function start(method: Method) {
    setBusy(true);
    setMessage(null);
    setBackupCodes(null);
    setCode("");
    try {
      const res = await fetch("/api/auth/2fa/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) return setMessage({ tone: "error", text: typeof body?.error === "string" ? body.error : "Setup could not start. Try again." });
      setSetup(method === "TOTP" ? { phase: "totp", qr: String(body.qr ?? ""), secret: String(body.secret ?? "") } : { phase: "email" });
    } catch {
      setMessage({ tone: "error", text: "Setup could not start: the connection failed." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (setup.phase === "idle") return;
    setBusy(true);
    setMessage(null);
    try {
      const method: Method = setup.phase === "totp" ? "TOTP" : "EMAIL";
      const res = await fetch("/api/auth/2fa/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, code: code.trim() }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) return setMessage({ tone: "error", text: typeof body?.error === "string" ? body.error : "That code was not accepted." });
      setBackupCodes(Array.isArray(body.backupCodes) ? (body.backupCodes as string[]) : null);
      setSetup({ phase: "idle" });
      setCode("");
      setMessage({ tone: "ok", text: `Two-step sign-in is on with the ${METHOD_WORD[method]}.` });
      setAttempt((value) => value + 1);
    } catch {
      setMessage({ tone: "error", text: "Not turned on: the connection failed." });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/2fa/settings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await res.json().catch(() => null);
      setPassword("");
      if (!res.ok) return setMessage({ tone: "error", text: `Still on: ${typeof body?.error === "string" ? body.error : "try again."}` });
      setShowTurnOff(false);
      setBackupCodes(null);
      setMessage({ tone: "ok", text: "Two-step sign-in is off. Anyone with your password can sign in." });
      setAttempt((value) => value + 1);
    } catch {
      setMessage({ tone: "error", text: "Still on: the connection failed." });
    } finally {
      setBusy(false);
    }
  }

  const status = load.kind === "ready" ? load.status : null;
  const state: CardState | null = !status
    ? null
    : status.enabled
      ? { text: `On · ${status.method ? METHOD_WORD[status.method] : "method not recorded"}`, shape: "dot" }
      : { text: "Off", shape: "ring" };
  const requirement = status?.requirement;
  const locked = busy || Boolean(readOnlyReason);

  return (
    <div ref={cardRef}>
      <ProfileCard id="two-step" title="Two-step sign-in" state={state}>
        {load.kind === "loading" ? (
          <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : load.kind === "failed" ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.875rem]">
            {load.message} It is not shown as off.
            <EButton variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</EButton>
          </div>
        ) : status ? (
          <div className="space-y-3">
            {requirement?.kind === "setup_required" ? (
              <EToneNotice tone="problem" title="Required for administrators">
                Turn on two-step sign-in to keep using the admin pages. This page, sign-out and recovery always stay open.
              </EToneNotice>
            ) : requirement?.kind === "grace" ? (
              <EToneNotice tone="attention" title="Required for administrators">
                {requirement.deadline
                  ? `Turn it on by ${formatDeadline(requirement.deadline, timeZone)}. After that, admin pages open only once it is on.`
                  : "Turn it on within 14 days. After that, admin pages open only once it is on."}
              </EToneNotice>
            ) : requirement?.kind === "suggested" ? (
              <EToneNotice tone="info" title="Suggested for operations managers">Off. Anyone with your password can sign in.</EToneNotice>
            ) : null}

            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {status.enabled
                ? status.method === "EMAIL"
                  ? "After your password, sign-in asks for a 6-digit code sent to your email."
                  : "After your password, sign-in asks for a 6-digit code from your authenticator app."
                : "Off. Turn on: scan the code (or get an email code), enter one code, save the backup codes."}
            </p>

            {status.enabled ? (
              <p className="text-[0.8125rem]">
                Backup codes · <span className="e-tnum">{status.backupCodesRemaining}</span> of 10 left. Each works once if you lose your phone; shown in full only when created.
              </p>
            ) : null}

            {backupCodes ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.8125rem] font-[600]">Your backup codes, shown once</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[0.8125rem]">
                  {backupCodes.map((backup) => <li key={backup}>{backup}</li>)}
                </ul>
                <p className={PROFILE_HINT}>Keep them somewhere safe. Each works once.</p>
              </div>
            ) : null}

            {setup.phase !== "idle" ? (
              <form onSubmit={confirm} className="space-y-2">
                {setup.phase === "totp" ? (
                  <div className="flex flex-wrap items-start gap-3">
                    {setup.qr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={setup.qr} alt="Code to scan with your authenticator app" className="h-36 w-36 rounded bg-white p-1" />
                    ) : null}
                    <p className="min-w-0 flex-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                      Scan it with your authenticator app, or type this key: <span className="font-mono">{setup.secret}</span>
                    </p>
                  </div>
                ) : (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">We sent a 6-digit code to {status.email ?? "your email"}.</p>
                )}
                <fieldset disabled={busy} className="space-y-2">
                  <label htmlFor={`${id}-code`} className={PROFILE_LABEL}>Code</label>
                  <input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" className={PROFILE_INPUT} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} />
                  <div className="flex flex-wrap gap-2">
                    <EButton type="submit" size="sm" disabled={code.length < 6}>{busy ? "Checking…" : "Confirm code"}</EButton>
                    <EButton type="button" variant="ghost" size="sm" onClick={() => { setSetup({ phase: "idle" }); setCode(""); }}>Cancel</EButton>
                  </div>
                </fieldset>
              </form>
            ) : showTurnOff ? (
              <form onSubmit={turnOff}>
                <fieldset disabled={busy} className="space-y-2">
                  <label htmlFor={`${id}-password`} className={PROFILE_LABEL}>Your password</label>
                  <input id={`${id}-password`} type="password" autoComplete="current-password" className={PROFILE_INPUT} value={password} onChange={(event) => setPassword(event.target.value)} />
                  {requirement?.kind === "met" && requirement.required ? (
                    <p className={PROFILE_HINT}>Administrators need two-step sign-in: turning it off sends you back here before other admin pages open.</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <EButton type="submit" variant="danger" size="sm" disabled={!password}>{busy ? "Turning off…" : "Turn off"}</EButton>
                    <EButton type="button" variant="ghost" size="sm" onClick={() => { setShowTurnOff(false); setPassword(""); }}>Cancel</EButton>
                  </div>
                </fieldset>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                {status.enabled ? (
                  <>
                    <EButton variant="outline" size="sm" disabled={locked} onClick={() => void start(status.method === "EMAIL" ? "TOTP" : "EMAIL")}>
                      {status.method === "EMAIL" ? "Switch to authenticator app…" : "Switch to email code…"}
                    </EButton>
                    <EButton variant="outline" size="sm" disabled={locked || !status.hasPassword} onClick={() => setShowTurnOff(true)}>Turn off…</EButton>
                  </>
                ) : (
                  <>
                    <EButton size="sm" disabled={locked} onClick={() => void start("TOTP")}>Turn on with an authenticator app</EButton>
                    <EButton variant="outline" size="sm" disabled={locked} onClick={() => void start("EMAIL")}>Use email codes instead</EButton>
                  </>
                )}
              </div>
            )}
            <p className={PROFILE_HINT}>
              {readOnlyReason ?? "Switching method asks for a code from the new method first, so you are never left without one. Lost your second factor? Another administrator can reset it with their PIN."}
            </p>
            <ProfileMessage message={message} />
          </div>
        ) : null}
      </ProfileCard>
    </div>
  );
}
