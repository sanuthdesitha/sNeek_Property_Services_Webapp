"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  scale: "Scale",
};

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const planKey = params.get("plan") ?? "starter";

  const [form, setForm] = useState({ businessName: "", fullName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/saas/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, planKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          setError("Public signup isn't switched on yet — we're putting the final touches on it.");
        } else {
          setError(data?.error ?? "Something went wrong. Please try again.");
        }
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1800);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-8 text-center">
        <h2 className="text-xl font-semibold text-white">Your workspace is ready 🎉</h2>
        <p className="mt-2 text-slate-300">Redirecting you to sign in…</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-center text-sm text-amber-300">
        Starting on the <strong>{PLAN_LABELS[planKey] ?? "Starter"}</strong> plan · 30-day free trial · no card required
      </div>

      <Field label="Business name" value={form.businessName} onChange={update("businessName")} placeholder="Acme Cleaning Co." autoComplete="organization" />
      <Field label="Your name" value={form.fullName} onChange={update("fullName")} placeholder="Jordan Smith" autoComplete="name" />
      <Field label="Work email" type="email" value={form.email} onChange={update("email")} placeholder="you@business.com" autoComplete="email" />
      <Field label="Password" type="password" value={form.password} onChange={update("password")} placeholder="At least 8 characters" autoComplete="new-password" />

      {error && (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-amber-400 px-6 py-3 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-60 transition-colors"
      >
        {submitting ? "Creating your workspace…" : "Create my workspace"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="text-amber-300 hover:text-amber-200">Sign in</Link>
      </p>
    </form>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-slate-300">{label}</span>
      <input
        {...props}
        required
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
      />
    </label>
  );
}
