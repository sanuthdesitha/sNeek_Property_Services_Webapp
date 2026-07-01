"use client";

import { useEffect, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Gates its children behind an admin PIN / password re-auth prompt. Once
 * unlocked it stays unlocked for the rest of the browser session (per lockId),
 * so navigating away and back doesn't re-prompt. Set an admin PIN under
 * Profile → Security; the account password also works.
 */
export function AdminPageLock({
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
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
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
              : body.error || "Verification failed.",
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
            <div className="space-y-1.5">
              <Label htmlFor="pagelock-pin">Admin PIN</Label>
              <Input
                id="pagelock-pin"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4+ digits"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pagelock-password">Password</Label>
              <Input
                id="pagelock-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Use your account password if no PIN set"
                autoComplete="current-password"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
