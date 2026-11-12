"use client";

import { useEffect, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";

/**
 * Gates its children behind the person's OWN PIN (or, while they have none,
 * their account password once and a new PIN). Once unlocked it stays unlocked
 * for the rest of the browser tab for that signed-in person only (per lockId
 * and account), so navigating away and back doesn't re-prompt and another
 * person on the same tab starts locked. The PIN is set in the profile.
 */
export function AdminPageLock({
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
  const storageKey = userId ? `sneek_pagelock_${lockId}:${userId}` : null;
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try {
      if (sessionStorage.getItem(storageKey) === "1") setUnlocked(true);
    } catch {
      /* sessionStorage unavailable */
    }
  }, [storageKey]);

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
      if (storageKey) {
        try {
          sessionStorage.setItem(storageKey, "1");
        } catch {
          /* ignore */
        }
      }
      setUnlocked(true);
      ownPin.reset();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
      <Card className="w-full">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <OwnPinFields {...ownPin.fieldProps} disabled={busy} />
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full gap-2" disabled={busy}>
              <ShieldCheck className="h-4 w-4" />
              {busy ? "Verifying…" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
