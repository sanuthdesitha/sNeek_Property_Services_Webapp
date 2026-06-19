"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldOff, Smartphone, Mail, Loader2 } from "lucide-react";

type Status = {
  enabled: boolean;
  method: "TOTP" | "EMAIL" | null;
  backupCodesRemaining: number;
  hasPassword: boolean;
  email: string | null;
};

type SetupState =
  | { phase: "idle" }
  | { phase: "totp"; qr: string; secret: string }
  | { phase: "email" };

export function TwoFactorSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupState>({ phase: "idle" });
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/settings");
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function startSetup(method: "TOTP" | "EMAIL") {
    setBusy(true); setError(null); setBackupCodes(null); setCode("");
    try {
      const res = await fetch("/api/auth/2fa/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Could not start setup."); return; }
      if (method === "TOTP") setSetup({ phase: "totp", qr: body.qr, secret: body.secret });
      else setSetup({ phase: "email" });
    } finally { setBusy(false); }
  }

  async function confirmSetup() {
    if (setup.phase === "idle") return;
    setBusy(true); setError(null);
    try {
      const method = setup.phase === "totp" ? "TOTP" : "EMAIL";
      const res = await fetch("/api/auth/2fa/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "That code didn't work."); return; }
      setBackupCodes(body.backupCodes || []);
      setSetup({ phase: "idle" });
      setCode("");
      await load();
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/auth/2fa/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Could not disable."); return; }
      setShowDisable(false);
      setDisablePassword("");
      setBackupCodes(null);
      await load();
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading security settings…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {status?.enabled ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <ShieldOff className="h-5 w-5 text-muted-foreground" />}
            <CardTitle className="text-base">Two-step verification</CardTitle>
          </div>
          {status?.enabled ? (
            <Badge variant="success" className="text-xs">On · {status.method === "TOTP" ? "Authenticator" : "Email"}</Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">Off</Badge>
          )}
        </div>
        <CardDescription>
          Add a second step at sign-in. You won&apos;t be asked on devices you trust for 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {/* One-time backup codes, shown right after enabling */}
        {backupCodes && (
          <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3">
            <p className="text-sm font-semibold">Save your backup codes</p>
            <p className="mb-2 text-xs text-muted-foreground">
              Each works once if you lose access to your {status?.method === "EMAIL" ? "email" : "authenticator"}. Store them somewhere safe — they won&apos;t be shown again.
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-sm">
              {backupCodes.map((c) => <span key={c} className="rounded bg-background px-2 py-1">{c}</span>)}
            </div>
          </div>
        )}

        {/* ENABLED */}
        {status?.enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? "" : "s"} remaining.
            </p>
            {showDisable ? (
              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-sm">Confirm your password to turn off 2FA</Label>
                <Input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} placeholder="Account password" />
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={disable} disabled={busy || !disablePassword}>Turn off 2FA</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowDisable(false); setDisablePassword(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowDisable(true)}>Turn off two-step verification</Button>
            )}
          </div>
        ) : setup.phase === "idle" ? (
          /* CHOOSE METHOD */
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => startSetup("TOTP")}
              disabled={busy}
              className="flex items-start gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40 disabled:opacity-60"
            >
              <Smartphone className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Authenticator app</p>
                <p className="text-xs text-muted-foreground">Google Authenticator, Authy, 1Password. No SMS needed.</p>
              </div>
            </button>
            <button
              onClick={() => startSetup("EMAIL")}
              disabled={busy}
              className="flex items-start gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40 disabled:opacity-60"
            >
              <Mail className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Email code</p>
                <p className="text-xs text-muted-foreground">We email a 6-digit code at sign-in to {status?.email || "your address"}.</p>
              </div>
            </button>
          </div>
        ) : (
          /* CONFIRM SETUP */
          <div className="space-y-3">
            {setup.phase === "totp" && (
              <div className="space-y-2">
                <p className="text-sm">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={setup.qr} alt="2FA QR code" className="h-44 w-44 rounded-lg border bg-white p-2" />
                <p className="text-xs text-muted-foreground">
                  Can&apos;t scan? Enter this key manually: <code className="font-mono">{setup.secret}</code>
                </p>
              </div>
            )}
            {setup.phase === "email" && (
              <p className="text-sm">We emailed a 6-digit code to {status?.email}. Enter it below to finish.</p>
            )}
            <div className="space-y-1.5">
              <Label className="text-sm">Verification code</Label>
              <Input inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[200px]" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={confirmSetup} disabled={busy || !code}>Verify & turn on</Button>
              <Button variant="ghost" size="sm" onClick={() => { setSetup({ phase: "idle" }); setCode(""); setError(null); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
