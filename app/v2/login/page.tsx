"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { BiometricSignInButton } from "@/components/auth/biometric-sign-in-button";

/** v2 counterpart of ADMIN_RECOVERY_LOGIN_URL — stays inside the Estate skin. */
const V2_ADMIN_RECOVERY_LOGIN_URL = "/v2/login?admin=1";

/** Estate-token input styling for native inputs (no EInput primitive exists). */
const E_INPUT_CLASS =
  "h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] " +
  "px-3 text-[0.9375rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "transition-[border-color,box-shadow] duration-[160ms] " +
  "focus:outline-none focus:border-[hsl(var(--e-gold))] focus:ring-2 focus:ring-[hsl(var(--e-ring))] focus:ring-offset-2 focus:ring-offset-[hsl(var(--e-surface))] " +
  "disabled:opacity-50";

const E_LABEL_CLASS = "text-[0.8125rem] font-[550] tracking-[0.01em] text-[hsl(var(--e-text-secondary))]";

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

export default function LoginPageV2() {
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
  // Deep-link support: middleware may send us here with ?callbackUrl=/v2/...
  // Only honor same-app v2 paths; anything else falls back to the v2 portal root.
  const requestedCallback = searchParams.get("callbackUrl");
  const v2CallbackPath = requestedCallback && requestedCallback.startsWith("/v2") ? requestedCallback : "/v2";
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
      const callbackUrl = adminRecoveryMode
        ? `${window.location.origin}/v2/admin`
        : `${window.location.origin}${v2CallbackPath}`;
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

      let target = "/v2";
      try {
        const parsed = returnedUrl ?? new URL("/v2", window.location.origin);
        if (
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "0.0.0.0") &&
          parsed.origin !== window.location.origin
        ) {
          target = "/v2";
        } else {
          target = `${parsed.pathname}${parsed.search}${parsed.hash}` || "/v2";
        }
      } catch {}
      window.location.assign(target);
    } catch {
      setError("Sign in failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[hsl(var(--e-background))] p-4">
      {/* Champagne glow, kept faint per the Estate language. */}
      <div
        className="pointer-events-none absolute -top-24 right-[12%] hidden h-80 w-80 rounded-full opacity-[0.07] blur-3xl md:block"
        style={{ background: "hsl(var(--e-gold))" }}
      />
      <div className="w-full max-w-sm space-y-5 e-rise">
        {!isNativeApp ? (
          <div className="text-center">
            <Link
              href="/"
              className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))] underline-offset-4 hover:text-[hsl(var(--e-foreground))] hover:underline"
            >
              &larr; Back to home
            </Link>
          </div>
        ) : null}

        <ECard variant="ceremony" className="w-full">
          <ECardBody className="p-8">
            {/* Brand mark */}
            <div className="mb-6 text-center">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={`${branding.companyName} logo`}
                  className="mx-auto mb-4 h-12 w-12 rounded-full border border-[hsl(var(--e-border-gold)/0.5)] bg-white object-cover p-0.5"
                />
              ) : (
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-gold-soft))]">
                  <span className="e-serif text-[1.05rem] font-[520] text-[hsl(var(--e-gold-ink))]">S</span>
                </div>
              )}
              <EEyebrow className="justify-center">PRIVATE PORTAL</EEyebrow>
              <h1 className="e-display-sm mt-1.5">{branding.companyName}</h1>
              <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                {adminRecoveryMode ? "Admin recovery sign in" : "Sign in to your portal"}
              </p>
              <div className="e-thread mx-auto mt-5 w-16" />
            </div>

            {error && (
              <div
                className="mb-4 rounded-[var(--e-radius-lg)] border-l-[3px] p-4 text-[0.8125rem]"
                style={{
                  backgroundColor: "hsl(var(--e-danger-soft))",
                  borderColor: "hsl(var(--e-danger))",
                  color: "hsl(var(--e-foreground))",
                }}
              >
                {error}
              </div>
            )}

            {maintenanceLoginLocked ? (
              <div
                className="mb-4 rounded-[var(--e-radius-lg)] border-l-[3px] p-4 text-[0.8125rem]"
                style={{
                  backgroundColor: "hsl(var(--e-warning-soft))",
                  borderColor: "hsl(var(--e-warning))",
                  color: "hsl(var(--e-foreground))",
                }}
              >
                <strong>{siteStatus.message || "The website is currently under maintenance."}</strong>
                {siteStatus.supportMessage ? <span className="block pt-1">{siteStatus.supportMessage}</span> : null}
                {adminRecoveryMode ? (
                  <span className="block pt-2 font-medium">
                    Admin recovery mode is active. Only admin portal accounts can sign in while public login is disabled.
                  </span>
                ) : (
                  <span className="block pt-2">
                    Public login is disabled right now.
                    <Link
                      href={V2_ADMIN_RECOVERY_LOGIN_URL}
                      className="ml-1 inline-flex items-center gap-1 font-medium text-[hsl(var(--e-foreground))] underline-offset-4 hover:underline"
                    >
                      <ShieldAlert className="h-4 w-4" />
                      Admin recovery login
                    </Link>
                  </span>
                )}
              </div>
            ) : null}

            {twoFa ? (
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="twofa-code" className={E_LABEL_CLASS}>
                    {twoFa.method === "EMAIL" ? "Email code" : "Authenticator code"}
                  </label>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {twoFa.method === "EMAIL"
                      ? `We sent a 6-digit code to ${form.email}.`
                      : "Enter the 6-digit code from your authenticator app."}{" "}
                    You can also use a backup code.
                  </p>
                  <input
                    id="twofa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="123456"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={E_INPUT_CLASS}
                  />
                </div>
                <label className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[hsl(var(--e-border-strong))] accent-[hsl(var(--e-gold))]"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                  />
                  Trust this device for 30 days
                </label>
                <EButton type="submit" variant="gold" size="lg" className="w-full" disabled={loading}>
                  {loading ? "Verifying..." : "Verify & sign in"}
                </EButton>
                <button
                  type="button"
                  className="w-full text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                  onClick={() => { setTwoFa(null); setCode(""); setError(null); }}
                >
                  Back
                </button>
                <div className="border-t border-[hsl(var(--e-border))] pt-3 text-center">
                  {recoverySent ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      If two-step verification is on for {form.email}, we&apos;ve emailed a recovery link to turn it off.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
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
                  <div className="space-y-1.5">
                    <label htmlFor="email" className={E_LABEL_CLASS}>Email</label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className={E_INPUT_CLASS}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="password" className={E_LABEL_CLASS}>Password</label>
                      <Link
                        href="/forgot-password"
                        className="text-[0.75rem] text-[hsl(var(--e-gold-ink))] underline-offset-4 hover:underline"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className={E_INPUT_CLASS}
                    />
                  </div>
                  <EButton type="submit" variant="gold" size="lg" className="w-full" disabled={loading || signInBlocked}>
                    {loading ? "Signing in..." : adminRecoveryMode ? "Admin sign in" : "Sign in"}
                  </EButton>
                </form>

                {!signInBlocked ? (
                  <div className="mt-4">
                    <BiometricSignInButton
                      email={form.email}
                      callbackUrl={
                        adminRecoveryMode
                          ? `${typeof window !== "undefined" ? window.location.origin : ""}/v2/admin`
                          : v2CallbackPath
                      }
                      disabled={loading}
                      onError={(message) => setError(message || null)}
                    />
                  </div>
                ) : null}
              </>
            )}

            <p className="mt-5 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Need an account?{" "}
              <Link href="/register" className="text-[hsl(var(--e-gold-ink))] underline-offset-4 hover:underline">
                Register here
              </Link>
            </p>
          </ECardBody>
        </ECard>

        <p className="text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Prefer the classic look?{" "}
          <Link href="/login" className="underline-offset-4 hover:text-[hsl(var(--e-text-secondary))] hover:underline">
            Classic sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
