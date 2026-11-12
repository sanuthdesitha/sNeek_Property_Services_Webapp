"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import "@/app/v2/estate.css";
import { EButton } from "@/components/v2/ui/primitives";
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, AuthFrame } from "@/components/v2/public/auth-frame";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const linkValid = Boolean(email && token);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not reset password.");
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
    <AuthFrame
      eyebrow="Password reset"
      title="Set a new password"
      intro={email ? <p>for <span className="[overflow-wrap:anywhere]">{email}</span></p> : undefined}
    >
      {done ? (
        <div className="space-y-4">
          <p role="status" className="text-[0.875rem]">Your password has been reset. You can now sign in.</p>
          <EButton asChild variant="gold" size="lg" className="w-full">
            <Link href="/login">Go to sign in</Link>
          </EButton>
        </div>
      ) : !linkValid ? (
        <div className="space-y-4">
          <p role="alert" className="rounded-[var(--e-radius)] border-l-2 border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem]">
            This reset link is incomplete or invalid. Please request a new one.
          </p>
          <EButton asChild variant="outline" size="lg" className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </EButton>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* The link is checked when you submit; it works once and expires a
              short time after it was sent (the email states how long). */}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            This link works once and expires a short time after it was sent.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="password" className={AUTH_LABEL_CLASS}>New password</label>
            <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={AUTH_INPUT_CLASS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirm" className={AUTH_LABEL_CLASS}>Confirm password</label>
            <input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={AUTH_INPUT_CLASS} />
          </div>
          {error ? (
            <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
          ) : null}
          <EButton type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
            {loading ? "Saving…" : "Reset password"}
          </EButton>
        </form>
      )}
    </AuthFrame>
  );
}
