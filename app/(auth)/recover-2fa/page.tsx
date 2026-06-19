"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Recover2faPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const linkValid = Boolean(email && token);

  async function disable() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/recover/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not complete recovery.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(255,178,98,0.2),transparent_35%),radial-gradient(circle_at_86%_10%,rgba(38,157,169,0.2),transparent_31%)]" />
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Recover access</CardTitle>
          <CardDescription>Turn off two-step verification so you can sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Two-step verification is now off for <strong>{email}</strong>. Sign in with your password, then set up 2FA again from your profile.
                </AlertDescription>
              </Alert>
              <Button asChild className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            </div>
          ) : !linkValid ? (
            <Alert variant="destructive">
              <AlertDescription>This recovery link is incomplete or invalid. Please request a new one from the sign-in screen.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <p className="text-sm text-muted-foreground">
                This will switch off 2FA for <strong>{email}</strong> and forget your trusted devices. Continue?
              </p>
              <Button className="w-full" onClick={disable} disabled={loading}>
                {loading ? "Turning off…" : "Turn off 2FA"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="text-primary hover:underline">Cancel</Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
