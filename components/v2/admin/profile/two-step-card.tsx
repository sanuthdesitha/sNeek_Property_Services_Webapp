"use client";

/**
 * Your profile › Two-step sign-in. Status, set up (authenticator app or email
 * code), switch method and turn off, against /api/auth/2fa/settings (the
 * signed-in person only; refused while testing as someone else).
 *
 * Switching method runs the new method's setup first, so nobody is left
 * without one: two-step stays on with the old method until the new code is
 * confirmed. Turning off asks for the password.
 *
 * Backup codes (2026-11-17): the card says whether a set exists, how many are
 * left and when it was made; it never shows codes again. New codes are shown
 * once (BackupCodesDisplay), straight after two-step is turned on and after
 * "Make new backup codes…" (tier C, own PIN or password, which cancels every
 * older code). When the two-step prompt sent an administrator here, the setup
 * ends on their codes, then continues to Command.
 *
 * Requirement (lib/auth/two-step-policy.ts): administrators must turn it on;
 * the card names the grace deadline, or says it is now needed before other
 * admin pages open. Operations managers see it suggested.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { BackupCodesDisplay } from "@/components/v2/shared/backup-codes-display";
import { BACKUP_CODES_LOW } from "@/lib/auth/backup-code-format";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";
import { PROFILE_HINT, PROFILE_INPUT, PROFILE_LABEL, ProfileCard, ProfileMessage, type CardState } from "./profile-card";

type Method = "TOTP" | "EMAIL";

type Requirement =
  | { kind: "not_applicable" }
  | { kind: "met"; required: boolean }
  | { kind: "suggested" }
  | { kind: "grace"; deadline: string | null }
  | { kind: "setup_required"; since: string };

type BackupCodeSummary = {
  total: number;
  remaining: number;
  createdAt: string | null;
  olderSet: boolean;
};

/** Codes from the one response that returned them; forgotten when the person is done. */
type NewCodes = { codes: string[]; createdAt: string };

type Status = {
  enabled: boolean;
  method: Method | null;
  backupCodesRemaining: number;
  backupCodes?: BackupCodeSummary;
  hasPassword: boolean;
  email: string | null;
  requirement?: Requirement;
};

type Load = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; status: Status };
type Setup = { phase: "idle" } | { phase: "totp"; qr: string; secret: string } | { phase: "email" };
type Message = { tone: "ok" | "error"; text: string } | null;

const METHOD_WORD: Record<Method, string> = { TOTP: "authenticator app", EMAIL: "email code" };

function formatMade(iso: string, timeZone: string, withTime: boolean): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      weekday: withTime ? "short" : undefined,
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function backupLine(summary: BackupCodeSummary, timeZone: string): string {
  if (summary.total === 0) return "No backup codes yet. Make a set so you can still sign in without your usual second step.";
  const made = summary.olderSet
    ? "an older set, date not recorded"
    : summary.createdAt
      ? `made ${formatMade(summary.createdAt, timeZone, false)}`
      : "date not recorded";
  return `${summary.remaining} of ${summary.total} left · ${made}. Each works once; they are never shown again.`;
}

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
  const [newCodes, setNewCodes] = React.useState<NewCodes | null>(null);
  const [makingNew, setMakingNew] = React.useState(false);
  const [makeNewError, setMakeNewError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    // A refresh after a change keeps the card (and any new codes on screen) in place.
    setLoad((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
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
    if (prompted) cardRef.current?.scrollIntoView?.({ block: "start" });
  }, [prompted]);

  async function start(method: Method) {
    setBusy(true);
    setMessage(null);
    setNewCodes(null);
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
      setNewCodes(Array.isArray(body.backupCodes)
        ? { codes: body.backupCodes as string[], createdAt: typeof body.backupCodesCreatedAt === "string" ? body.backupCodesCreatedAt : new Date().toISOString() }
        : null);
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
      setNewCodes(null);
      setMessage({ tone: "ok", text: "Two-step sign-in is off. Anyone with your password can sign in." });
      setAttempt((value) => value + 1);
    } catch {
      setMessage({ tone: "error", text: "Still on: the connection failed." });
    } finally {
      setBusy(false);
    }
  }

  async function makeNewCodes(credentials: unknown) {
    setBusy(true);
    setMakeNewError(null);
    try {
      const res = await fetch("/api/auth/2fa/backup-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(body?.codes)) {
        setMakeNewError(`No new codes were made; your old ones still work. ${sensitiveVerificationText(body?.error)}`);
        return;
      }
      setMakingNew(false);
      setNewCodes({ codes: body.codes as string[], createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString() });
      setMessage({ tone: "ok", text: "New backup codes made. Every older code has stopped working." });
      setAttempt((value) => value + 1);
    } catch {
      setMakeNewError("No new codes were made: the connection failed. Your old ones still work.");
    } finally {
      setBusy(false);
    }
  }

  function finishWithCodes() {
    setNewCodes(null);
    // Sent here by the administrator requirement: setup ends on the codes, then back to work.
    if (prompted) window.location.assign("/v2/admin");
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

            {status.enabled && !newCodes ? (
              <div className="space-y-2">
                <p className="text-[0.8125rem]">
                  <span className="font-[600]">Backup codes</span> ·{" "}
                  <span className="e-tnum">{backupLine(status.backupCodes ?? { total: status.backupCodesRemaining, remaining: status.backupCodesRemaining, createdAt: null, olderSet: false }, timeZone)}</span>
                </p>
                {status.backupCodes && status.backupCodes.total > 0 && status.backupCodes.remaining <= BACKUP_CODES_LOW ? (
                  <EToneNotice tone="attention" title={status.backupCodes.remaining === 0 ? "No backup codes left" : `Only ${status.backupCodes.remaining} backup code${status.backupCodes.remaining === 1 ? "" : "s"} left`}>
                    Make new ones before you run out. The new set replaces every older code.
                  </EToneNotice>
                ) : null}
              </div>
            ) : null}

            {newCodes ? (
              <BackupCodesDisplay
                codes={newCodes.codes}
                createdLabel={formatMade(newCodes.createdAt, timeZone, true)}
                accountEmail={status.email}
                onDone={finishWithCodes}
                doneLabel={prompted ? "I've saved them, continue to Command" : "I've saved them"}
              />
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
                    <EButton variant="outline" size="sm" disabled={locked || Boolean(newCodes)} onClick={() => { setMakeNewError(null); setMakingNew(true); }}>Make new backup codes…</EButton>
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
        <EConfirmDialog
          open={makingNew}
          tier="sensitive"
          title="Make new backup codes?"
          description="You get ten new codes, shown once. Every code you have now stops working straight away."
          confirmLabel="Make new codes"
          busy={busy}
          error={makeNewError}
          onClose={() => { if (!busy) setMakingNew(false); }}
          onConfirm={async ({ credentials }) => {
            if (!credentials) return;
            await makeNewCodes(credentials);
          }}
        />
      </ProfileCard>
    </div>
  );
}
