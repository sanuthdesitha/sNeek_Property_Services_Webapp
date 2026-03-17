"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function signInWithCredentials(input: { email: string; password: string; callbackUrl: string }) {
  const csrfRes = await fetch("/api/auth/csrf", { cache: "no-store" });
  if (!csrfRes.ok) {
    throw new Error("Could not initialize sign in.");
  }

  const csrfData = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfData.csrfToken) {
    throw new Error("Missing CSRF token.");
  }

  const body = new URLSearchParams({
    email: input.email,
    password: input.password,
    csrfToken: csrfData.csrfToken,
    callbackUrl: input.callbackUrl,
    json: "true",
  });

  const res = await fetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  let data: { url?: string } | null = null;
  try {
    data = (await res.json()) as { url?: string };
  } catch {
    data = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    url: typeof data?.url === "string" ? data.url : null,
  };
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branding, setBranding] = useState({ companyName: "sNeek Property Services", logoUrl: "" });
  const [form, setForm] = useState({ email: "", password: "" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setError("Invalid credentials. Please try again.");
    }
    fetch("/api/public/branding")
      .then((r) => r.json())
      .then((data) => {
        setBranding({
          companyName: typeof data?.companyName === "string" && data.companyName.trim() ? data.companyName.trim() : "sNeek Property Services",
          logoUrl: typeof data?.logoUrl === "string" ? data.logoUrl : "",
        });
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const callbackUrl = `${window.location.origin}/`;
      const res = await signInWithCredentials({
        email: form.email,
        password: form.password,
        callbackUrl,
      });

      const returnedUrl = res.url ? new URL(res.url, window.location.origin) : null;
      const returnedError = returnedUrl?.searchParams.get("error");

      if (!res.ok || returnedError) {
        setError("Invalid email or password.");
        setLoading(false);
        return;
      }

      let target = "/";
      try {
        const parsed = returnedUrl ?? new URL("/", window.location.origin);
        if (
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "0.0.0.0") &&
          parsed.origin !== window.location.origin
        ) {
          target = "/";
        } else {
          target = `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
        }
      } catch {}
      window.location.assign(target);
    } catch {
      setError("Sign in failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(255,178,98,0.2),transparent_35%),radial-gradient(circle_at_86%_10%,rgba(38,157,169,0.2),transparent_31%)]" />
      <Card className="w-full max-w-sm shadow-xl page-fade">
        <CardHeader className="text-center">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={`${branding.companyName} logo`}
              className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-white object-cover p-0.5 shadow-[0_10px_24px_-12px_hsl(var(--primary)/0.75)]"
            />
          ) : (
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-[0_10px_24px_-12px_hsl(var(--primary)/0.75)]">
              <span className="text-white font-bold text-base tracking-wide">SP</span>
            </div>
          )}
          <CardTitle className="text-2xl">{branding.companyName}</CardTitle>
          <CardDescription>Sign in to your portal</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Need an account?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Register here
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
