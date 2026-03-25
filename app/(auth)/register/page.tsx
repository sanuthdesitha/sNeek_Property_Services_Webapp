"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type RegisterRole = "CLEANER" | "CLIENT";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branding, setBranding] = useState({ companyName: "sNeek Property Services", logoUrl: "" });
  const [step, setStep] = useState<"register" | "verify">("register");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "CLIENT" as RegisterRole,
    phone: "",
    clientName: "",
    clientAddress: "",
  });

  useEffect(() => {
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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        phone: form.phone || undefined,
        clientName: form.role === "CLIENT" ? form.clientName : undefined,
        clientAddress: form.role === "CLIENT" ? form.clientAddress : undefined,
      };

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Registration failed.");
      }

      setRegisteredEmail(form.email);
      setStep("verify");
    } catch (err: any) {
      setError(err.message ?? "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!registeredEmail) {
      setError("Email is missing. Restart registration.");
      setStep("register");
      return;
    }

    setVerifying(true);
    try {
      const verifyRes = await fetch("/api/auth/register/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registeredEmail, code: otpCode.trim() }),
      });
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyBody.error ?? "OTP verification failed.");
      }

      const signin = await signIn("credentials", {
        email: registeredEmail,
        password: form.password,
        redirect: false,
      });

      if (signin?.error) {
        router.push("/login");
        return;
      }

      router.push("/");
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "OTP verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  async function resendOtp() {
    setError(null);
    if (!registeredEmail) return;

    setResendingOtp(true);
    try {
      const res = await fetch("/api/auth/register/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registeredEmail }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to resend OTP.");
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to resend OTP.");
    } finally {
      setResendingOtp(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(255,178,98,0.2),transparent_35%),radial-gradient(circle_at_86%_10%,rgba(38,157,169,0.2),transparent_31%)]" />
      <Card className="w-full max-w-lg shadow-xl page-fade">
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
          <CardTitle className="text-2xl">
            {step === "register" ? "Create Account" : "Verify Email"}
          </CardTitle>
          <CardDescription>
            {step === "register"
              ? `Register to ${branding.companyName}`
              : `Enter the 6-digit OTP sent to ${registeredEmail}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === "register" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    required
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={(value: RegisterRole) => setForm((prev) => ({ ...prev, role: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CLIENT">Client</SelectItem>
                      <SelectItem value="CLEANER">Cleaner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Phone (optional)</Label>
                  <Input
                    type="tel"
                    inputMode="tel"
                    maxLength={16}
                    placeholder="0451217210 or +61451217210"
                    value={form.phone}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
              </div>

              {form.role === "CLIENT" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Client Name</Label>
                    <Input
                      required
                      value={form.clientName}
                      onChange={(e) => setForm((prev) => ({ ...prev, clientName: e.target.value }))}
                      placeholder="Your business or profile name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Client Address (optional)</Label>
                    <Input
                      value={form.clientAddress}
                      onChange={(e) => setForm((prev) => ({ ...prev, clientAddress: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={form.confirmPassword}
                    onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating account..." : "Create account"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="otpCode">OTP code</Label>
                <Input
                  id="otpCode"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifying || otpCode.length !== 6}>
                {verifying ? "Verifying..." : "Verify and continue"}
              </Button>
              <Button type="button" variant="outline" className="w-full" disabled={resendingOtp} onClick={resendOtp}>
                {resendingOtp ? "Sending..." : "Resend OTP"}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
