"use client";

/**
 * Lock screen for the "Test as" console.
 *
 * Same credential contract as the pricing page lock (admin PIN or account
 * password, verified server-side with bcrypt) — but the proof is a signed,
 * httpOnly, 15-minute cookie minted by POST /api/admin/test-as/unlock rather
 * than a sessionStorage flag, because POST /api/admin/impersonate enforces it
 * too. That is why a successful unlock reloads the page: the picker is rendered
 * by the server only once the cookie is present.
 */
import * as React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/admin/estate-kit";

function messageFor(body: { error?: string; retryAfterSec?: number }): string {
  switch (body.error) {
    case "INVALID_SECURITY_VERIFICATION":
      return "Incorrect PIN or password.";
    case "PIN_OR_PASSWORD_REQUIRED":
      return "Enter your admin PIN or your account password.";
    case "TOO_MANY_ATTEMPTS": {
      const minutes = Math.max(1, Math.ceil((body.retryAfterSec ?? 900) / 60));
      return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "FORBIDDEN":
      return "Only a full admin can open the Test as console.";
    case "UNAUTHORIZED":
      return "Your session expired. Sign in again.";
    default:
      return body.error || "Verification failed.";
  }
}

export function TestAsLock() {
  const [pin, setPin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [lockedOut, setLockedOut] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!pin.trim() && !password.trim()) {
      setError("Enter your admin PIN or your account password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/test-as/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() || undefined, password: password || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; retryAfterSec?: number };
      if (!res.ok || !body.ok) {
        setLockedOut(body.error === "TOO_MANY_ATTEMPTS");
        setError(messageFor(body));
        setPassword("");
        setPin("");
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
    <div className="mx-auto flex min-h-[50vh] max-w-md items-center">
      <ECard variant="ceremony" className="w-full">
        <ECardBody className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
              <Lock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-[1rem] font-semibold">Confirm your password</h2>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Confirm your password to view the portals as another user.
              </p>
            </div>
          </div>

          <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Being signed in as an admin is not enough for this console — it can act as any user in
            the business. The unlock lasts 15 minutes and is recorded against your account.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <EField label="Admin PIN">
              <EInput
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4+ digits"
                autoComplete="off"
                disabled={busy || lockedOut}
              />
            </EField>
            <EField label="Password" hint="Use your account password if no PIN is set.">
              <EInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy || lockedOut}
              />
            </EField>
            {error ? (
              <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
                {error}
              </p>
            ) : null}
            <EButton type="submit" variant="gold" className="w-full" disabled={busy || lockedOut}>
              <ShieldCheck className="h-4 w-4" />
              {busy ? "Verifying…" : "Unlock"}
            </EButton>
          </form>
        </ECardBody>
      </ECard>
    </div>
  );
}
