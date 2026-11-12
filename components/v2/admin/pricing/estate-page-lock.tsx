"use client";

/**
 * Estate-native re-auth gate for the Rate card and Price book. Asks for the
 * person's OWN PIN (or, while they have none, their account password once and
 * a new PIN), verifies via POST /api/admin/security/verify, and — once
 * unlocked — stays unlocked for the rest of the browser tab for THAT person
 * only (sessionStorage key per lockId and signed-in account), so another
 * person signing in on the same tab starts locked. No dependency on
 * components/{admin,ui}/*.
 */
import * as React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";

function pageLockStorageKey(lockId: string, userId: string): string {
  return `sneek_pagelock_${lockId}:${userId}`;
}

function readUnlocked(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function rememberUnlocked(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* sessionStorage unavailable: the page stays unlocked until it reloads */
  }
}

export function EstatePageLock({
  lockId,
  title = "This page is locked",
  description = "Enter your PIN to view and edit this page.",
  children,
}: {
  lockId: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const ownPin = useOwnPinPrompt(true);
  const userId = ownPin.userId;
  const [unlockedFor, setUnlockedFor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (userId && readUnlocked(pageLockStorageKey(lockId, userId))) setUnlockedFor(userId);
  }, [lockId, userId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ownPin.credentials) {
      setError(ownPin.problem ?? "Enter your PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/security/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ownPin.credentials),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(sensitiveVerificationText(body.error));
        return;
      }
      if (userId) rememberUnlocked(pageLockStorageKey(lockId, userId));
      setUnlockedFor(userId ?? "this-page");
      ownPin.reset();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (unlockedFor && (unlockedFor === userId || unlockedFor === "this-page")) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
      <ECard variant="ceremony" className="w-full">
        <ECardBody className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
              <Lock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-[1rem] font-semibold">{title}</h2>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <OwnPinFields {...ownPin.fieldProps} disabled={busy} />
            {error ? (
              <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
            ) : null}
            <EButton type="submit" variant="gold" className="w-full" disabled={busy}>
              <ShieldCheck className="h-4 w-4" />
              {busy ? "Verifying…" : "Unlock"}
            </EButton>
          </form>
        </ECardBody>
      </ECard>
    </div>
  );
}
