"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BiometricSignInButton } from "@/components/auth/biometric-sign-in-button";
import { ADMIN_RECOVERY_LOGIN_URL } from "@/lib/public-site/routing";

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
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branding, setBranding] = useState({ companyName: "sNeek Property Services", logoUrl: "" });
  const [siteStatus, setSiteStatus] = useState({ maintenanceEnabled: false, allowLogin: true, message: "", supportMessage: "" });
  // Inside the native mobile shell we hide the "Back to home" link — the app
  // has no public marketing site to go back to.
  const [isNativeApp, setIsNativeApp] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  // Two-step verification: when the password is right but 2FA is on, we switch
  // to a code-entry step before completing sign-in.
  const [twoFa, setTwoFa] = useState<{ method: "TOTP" | "EMAIL" } | null>(null);
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const adminRecoveryMode = searchParams.get("admin") === "1";
  const maintenanceLoginLocked = siteStatus.maintenanceEnabled && !siteStatus.allowLogin;
  const signInBlocked = maintenanceLoginLocked && !adminRecoveryMode;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setError("Invalid credentials. Please try again.");
    }
    // Detect the native mobile shell: it injects a native context object and
    // uses a "sNeekMobile" user agent.
    const w = window as typeof window & { __SNEEK_NATIVE_CONTEXT__?: unknown };
    const nativeContext =
      !!w.__SNEEK_NATIVE_CONTEXT__ ||
      (typeof window.localStorage !== "undefined" && !!window.localStorage.getItem("sneek-native-context"));
    const nativeUa = /sNeekMobile/i.test(navigator.userAgent || "");
    if (nativeContext || nativeUa) setIsNativeApp(true);
    fetch("/api/public/branding")
      .then((r) => r.json())
      .then((data) => {
        setBranding({
          companyName: typeof data?.companyName === "string" && data.companyName.trim() ? data.companyName.trim() : "sNeek Property Services",
          logoUrl: typeof data?.logoUrl === "string" ? data.logoUrl : "",
        });
      })
      .catch(() => {});
    fetch("/api/public/site-status")
      .then((r) => r.json())
      .then((data) =>
        setSiteStatus({
          maintenanceEnabled: data?.maintenanceEnabled === true,
          allowLogin: data?.allowLogin !== false,
          message: typeof data?.message === "string" ? data.message : "",
          supportMessage: typeof data?.supportMessage === "string" ? data.supportMessage : "",
        })
      )
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (signInBlocked) {
      setError(siteStatus.message || "The website is currently under maintenance.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Step 1: check the password and whether a second factor is required.
      const begin = await fetch("/api/auth/2fa/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password }),
      })
        .then((r) => r.json())
        .catch(() => null);

      if (begin?.required) {
        setTwoFa({ method: begin.method === "EMAIL" ? "EMAIL" : "TOTP" });
        setLoading(false);
        return;
      }
      await doSignIn();
    } catch {
      setError("Sign in failed. Please try again.");
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/2fa/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          code,
          remember: rememberDevice,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Invalid or expired code.");
        setLoading(false);
        return;
      }
      await doSignIn();
    } catch {
      setError("Verification failed. Please try again.");
      setLoading(false);
    }
  }

  async function requestTwoFaRecovery() {
    try {
      await fetch("/api/auth/2fa/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
    } catch {
      /* always show the same confirmation */
    }
    setRecoverySent(true);
  }

  async function doSignIn() {
    try {
      const callbackUrl = adminRecoveryMode ? `${window.location.origin}/admin` : `${window.location.origin}/`;
      const res = await signInWithCredentials({
        email: form.email,
        password: form.password,
        callbackUrl,
      });

      const returnedUrl = res.url ? new URL(res.url, window.location.origin) : null;
      const returnedError = returnedUrl?.searchParams.get("error");

      if (!res.ok || returnedError) {
        // Turn the generic failure into an actionable reason where we can — the
        // usual culprits for staff (cleaners etc.) are an invited account that
        // never set a password, a deactivated account, or maintenance lockout.
        let message = "Invalid email or password.";
        try {
          const help = await fetch("/api/auth/login-help", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: form.email }),
          })
            .then((r) => r.json())
            .catch(() => null);
          if (help?.reason === "no-password") {
            message =
              "This account doesn't have a password set yet. Open the invite link we emailed you, or ask your admin to send a password reset.";
          } else if (help?.reason === "inactive") {
            message = "This account is inactive. Please contact your administrator.";
          } else if (help?.reason === "maintenance") {
            message =
              siteStatus.message || "Sign-in is temporarily disabled while we carry out maintenance.";
          }
        } catch {
          /* fall back to the generic message */
        }
        setError(message);
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
      <div className="w-full max-w-sm space-y-4 page-fade">
        {!isNativeApp ? (
          <div className="flex items-center rounded-full border border-border bg-surface/70 px-4 py-2 text-sm shadow-sm backdrop-blur-sm">
            <Link href="/" className="font-medium text-primary hover:underline">← Back to home</Link>
          </div>
        ) : null}
      <Card className="w-full max-w-sm shadow-xl">
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

          {maintenanceLoginLocked ? (
            <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-950">
              <AlertDescription>
                <strong>{siteStatus.message || "The website is currently under maintenance."}</strong>
                {siteStatus.supportMessage ? <span className="block pt-1">{siteStatus.supportMessage}</span> : null}
                {adminRecoveryMode ? (
                  <span className="block pt-2 text-sm font-medium">
                    Admin recovery mode is active. Only admin portal accounts can sign in while public login is disabled.
                  </span>
                ) : (
                  <span className="block pt-2">
                    Public login is disabled right now.
                    <Link href={ADMIN_RECOVERY_LOGIN_URL} className="ml-1 inline-flex items-center gap-1 font-medium text-amber-950 underline-offset-4 hover:underline">
                      <ShieldAlert className="h-4 w-4" />
                      Admin recovery login
                    </Link>
                  </span>
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {twoFa ? (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="twofa-code">
                  {twoFa.method === "EMAIL" ? "Email code" : "Authenticator code"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {twoFa.method === "EMAIL"
                    ? `We sent a 6-digit code to ${form.email}.`
                    : "Enter the 6-digit code from your authenticator app."}{" "}
                  You can also use a backup code.
                </p>
                <Input
                  id="twofa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                />
                Trust this device for 30 days
              </label>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Verifying..." : "Verify & sign in"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => { setTwoFa(null); setCode(""); setError(null); }}
              >
                Back
              </button>
              <div className="border-t pt-3 text-center">
                {recoverySent ? (
                  <p className="text-xs text-muted-foreground">
                    If two-step verification is on for {form.email}, we&apos;ve emailed a recovery link to turn it off.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={requestTwoFaRecovery}
                  >
                    Lost your authenticator and backup codes? Recover via email
                  </button>
                )}
              </div>
            </form>
          ) : (
            <>
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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading || signInBlocked}>
                  {loading ? "Signing in..." : adminRecoveryMode ? "Admin sign in" : "Sign in"}
                </Button>
              </form>

              {!signInBlocked ? (
                <div className="mt-4">
                  <BiometricSignInButton
                    email={form.email}
                    callbackUrl={adminRecoveryMode ? `${typeof window !== "undefined" ? window.location.origin : ""}/admin` : "/"}
                    disabled={loading}
                    onError={(message) => setError(message || null)}
                  />
                </div>
              ) : null}
            </>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Need an account?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Register here
            </Link>
          </p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
