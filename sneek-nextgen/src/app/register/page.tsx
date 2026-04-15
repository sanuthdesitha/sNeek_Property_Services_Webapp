"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Registration failed");
        return;
      }

      setSent(true);
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Check Your Email</CardTitle>
            <CardDescription>We&apos;ve sent you a verification code. Enter it to activate your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => router.push("/login")}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription>Register for a sNeek Ops account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                {error}
              </div>
            )}
            <Input name="name" label="Full Name" placeholder="John Doe" required />
            <Input name="email" label="Email" type="email" placeholder="you@example.com" required />
            <Input name="phone" label="Phone" type="tel" placeholder="+61 400 000 000" />
            <Input name="password" label="Password" type="password" placeholder="Min 8 characters" required minLength={8} />
            <Select
              name="role"
              label="Account Type"
              options={[
                { value: "CLIENT", label: "Client" },
                { value: "CLEANER", label: "Cleaner" },
              ]}
              placeholder="Select account type"
              required
            />
            <Button type="submit" loading={loading}>
              Create Account
            </Button>
            <p className="text-center text-sm text-text-secondary">
              Already have an account?{" "}
              <Link href="/login" className="text-text-link hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
