"use client";

/**
 * Lock screen for the "Test as" console.
 *
 * Same credential contract as the pricing page lock (the person's OWN PIN, or
 * while they have none their password once and a new PIN, verified server-side
 * with bcrypt) — but the proof is a signed,
 * httpOnly, 15-minute cookie minted by POST /api/admin/test-as/unlock rather
 * than a sessionStorage flag, because POST /api/admin/impersonate enforces it
 * too. That is why a successful unlock reloads the page: the picker is rendered
 * by the server only once the cookie is present.
 */
import * as React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";

function messageFor(body: { error?: string; retryAfterSec?: number }): string {
  switch (body.error) {
    case "TOO_MANY_ATTEMPTS": {
      const minutes = Math.max(1, Math.ceil((body.retryAfterSec ?? 900) / 60));
      return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "FORBIDDEN":
      return "Only an administrator, or someone they gave Test as, can open this.";
    case "UNAUTHORIZED":
      return "Your session expired. Sign in again.";
    default:
      return sensitiveVerificationText(body.error);
  }
}

export function TestAsLock({ relocked = false, isAdministrator = true }: { relocked?: boolean; isAdministrator?: boolean }) {
  const ownPin = useOwnPinPrompt(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [lockedOut, setLockedOut] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ownPin.credentials) {
      setError(ownPin.problem ?? "Enter your PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/test-as/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ownPin.credentials),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; retryAfterSec?: number };
      if (!res.ok || !body.ok) {
        setLockedOut(body.error === "TOO_MANY_ATTEMPTS");
        setError(messageFor(body));
        ownPin.reset();
        return;
      }
      // Full reload: the unlock cookie is httpOnly and the picker is rendered
      // server-side behind it.
      window.location.reload();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-[600]">
            <Lock aria-hidden className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
            Before the list: confirm it is you
          </h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {isAdministrator ? "Being an administrator opens this page" : "Your Test as permission opens this page"}; the list needs your PIN, valid for 15 minutes.
          </p>
        </div>
        {relocked ? (
          <p role="status" className={cn("rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]", toneNoticeClass("attention"))}>
            The 15-minute unlock has ended. Enter your PIN again.
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-3">
          <OwnPinFields {...ownPin.fieldProps} disabled={busy || lockedOut} />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">5 wrong tries lock it for 15 minutes.</p>
          {error ? (
            <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
              {error}
            </p>
          ) : null}
          <EButton type="submit" variant="primary" disabled={busy || lockedOut} className="max-sm:w-full">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {busy ? "Checking…" : "Unlock"}
          </EButton>
        </form>
      </ECardBody>
    </ECard>
  );
}
