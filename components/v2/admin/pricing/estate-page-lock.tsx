"use client";

/**
 * Estate-native re-auth gate. Replicates the v1 AdminPageLock behaviour used on
 * the pricing page: prompts for the admin PIN or account password, verifies via
 * POST /api/admin/security/verify, and — once unlocked — stays unlocked for the
 * rest of the browser session (per lockId, via sessionStorage). No dependency on
 * components/{admin,ui}/*.
 */
import * as React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/admin/estate-kit";

export function EstatePageLock({
  lockId,
  title = "This page is locked",
  description = "Enter your admin PIN or password to view and edit this page.",
  children,
}: {
  lockId: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const storageKey = `sneek_pagelock_${lockId}`;
  const [unlocked, setUnlocked] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey) === "1") setUnlocked(true);
    } catch {
      /* sessionStorage unavailable */
    }
    setReady(true);
  }, [storageKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim() && !password.trim()) {
      setError("Enter your admin PIN or password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/security/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() || undefined, password: password.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(
          body.error === "INVALID_SECURITY_VERIFICATION"
            ? "Incorrect PIN or password."
            : body.error === "PIN_OR_PASSWORD_REQUIRED"
              ? "Enter your admin PIN or password."
              : body.error || "Verification failed."
        );
        return;
      }
      try {
        sessionStorage.setItem(storageKey, "1");
      } catch {
        /* ignore */
      }
      setUnlocked(true);
      setPin("");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;
  if (unlocked) return <>{children}</>;

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
            <EField label="Admin PIN">
              <EInput
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4+ digits"
                autoComplete="off"
              />
            </EField>
            <EField label="Password" hint="Use your account password if no PIN is set.">
              <EInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </EField>
            {error ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
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
