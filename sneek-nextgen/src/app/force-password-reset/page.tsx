"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KeyRound, CheckCircle2 } from "lucide-react";

export default function ForcePasswordResetPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;
    const token = formData.get("token") as string;

    if (!token) {
      setError("Reset token is required");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reset password");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-success-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-text-primary mb-2">Password Reset!</h2>
            <p className="text-text-secondary mb-6">Your password has been reset successfully.</p>
            <Button asChild><Link href="/login">Sign In</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="pt-6">
          <div className="text-center mb-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600">
              <KeyRound className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary">Reset Your Password</h1>
            <p className="text-text-secondary mt-1">Please set a new password for your account</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">{error}</div>
            )}
            <Input name="token" label="Reset Token" placeholder="Enter your reset token" required />
            <Input name="password" label="New Password" type="password" placeholder="Min 8 characters" minLength={8} required />
            <Input name="confirmPassword" label="Confirm New Password" type="password" placeholder="Re-enter password" required />
            <Button type="submit" className="w-full" loading={loading}>Reset Password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
