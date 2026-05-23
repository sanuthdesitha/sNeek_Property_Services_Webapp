"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

export function ApplyForm({ positionId, positionTitle }: { positionId: string; positionTitle: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    coverLetter: "",
    resumeUrl: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/public/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionId, ...form }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Could not submit application.");
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
        <h2 className="font-bold text-green-900">Application received</h2>
        <p className="mt-1 text-sm text-green-800">
          Thanks for applying for <strong>{positionTitle}</strong>. Our team will review and get back to you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      <Input label="Full name" required value={form.fullName} onChange={(v) => setForm((p) => ({ ...p, fullName: v }))} />
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Email" type="email" required value={form.email} onChange={(v) => setForm((p) => ({ ...p, email: v }))} />
        <Input label="Phone" type="tel" value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
      </div>
      <Input label="Resume link (optional)" placeholder="https://..." value={form.resumeUrl} onChange={(v) => setForm((p) => ({ ...p, resumeUrl: v }))} />
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">Cover letter</label>
        <textarea
          rows={5}
          value={form.coverLetter}
          onChange={(e) => setForm((p) => ({ ...p, coverLetter: e.target.value }))}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Tell us why you'd like to join sNeek."
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Submit application"}
      </button>
    </form>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}