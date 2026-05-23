"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ChevronRight } from "lucide-react";

type Role = "ADMIN" | "OPS_MANAGER" | "CLEANER" | "CLIENT" | "LAUNDRY";

type OnboardingResponse = {
  user: { id: string; name: string | null; email: string; phone: string | null; role: Role };
  extendedProfile: {
    businessName: string | null;
    abn: string | null;
    address: string | null;
    contactNumber: string | null;
    bankDetails: {
      accountName: string;
      bankName: string;
      bsb: string;
      accountNumber: string;
    } | null;
  } | null;
  state: { requiresOnboarding: boolean; tutorialSeen: boolean };
  missingFields: string[];
  onboardingComplete: boolean;
};

const TOUR_STEPS = [
  { title: "Welcome", body: "This quick walkthrough shows where jobs, reports, and settings live." },
  { title: "Navigation", body: "Use the left menu for portal modules and top-right notifications for live updates." },
  { title: "Job Workflow", body: "Jobs move from Unassigned to Completed with forms, media evidence, and QA checks." },
  { title: "You're Ready", body: "Save required profile details now. You can edit them later in Settings." },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [tourStep, setTourStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    businessName: "",
    abn: "",
    accountName: "",
    bankName: "",
    bsb: "",
    accountNumber: "",
  });

  const role = data?.user.role;
  const needsBusiness = role === "CLIENT" || role === "LAUNDRY";
  const needsBank = role === "CLEANER" || role === "LAUNDRY";
  const tutorialDone = data?.state.tutorialSeen || tourStep >= TOUR_STEPS.length;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/me/onboarding", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as OnboardingResponse;
      if (!res.ok) {
        setError((body as any).error ?? "Failed to load onboarding.");
        setLoading(false);
        return;
      }
      setData(body);
      setTourStep(body.state.tutorialSeen ? TOUR_STEPS.length : 0);
      setForm({
        name: body.user.name ?? "",
        phone: body.extendedProfile?.contactNumber ?? body.user.phone ?? "",
        address: body.extendedProfile?.address ?? "",
        businessName: body.extendedProfile?.businessName ?? "",
        abn: body.extendedProfile?.abn ?? "",
        accountName: body.extendedProfile?.bankDetails?.accountName ?? "",
        bankName: body.extendedProfile?.bankDetails?.bankName ?? "",
        bsb: body.extendedProfile?.bankDetails?.bsb ?? "",
        accountNumber: body.extendedProfile?.bankDetails?.accountNumber ?? "",
      });
      setLoading(false);
    })();
  }, []);

  const missingFieldsLabel = useMemo(() => {
    if (!data?.missingFields?.length) return "None";
    const labels = data.missingFields.map((field) =>
      field === "contactNumber" ? "phone" : field === "bankDetails" ? "bank details" : field === "businessName" ? "business name" : field
    );
    return Array.from(new Set(labels)).join(", ");
  }, [data?.missingFields]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/me/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        phone: form.phone,
        address: form.address,
        businessName: needsBusiness ? form.businessName : undefined,
        abn: needsBusiness ? form.abn : undefined,
        bankDetails: needsBank
          ? {
              accountName: form.accountName,
              bankName: form.bankName,
              bsb: form.bsb,
              accountNumber: form.accountNumber,
            }
          : undefined,
        tutorialSeen: tutorialDone,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not save onboarding.");
      return;
    }
    if (!body.onboardingComplete) {
      setData((prev) =>
        prev
          ? {
              ...prev,
              missingFields: Array.isArray(body.missingFields) ? body.missingFields : prev.missingFields,
              state: {
                ...prev.state,
                tutorialSeen: body.state?.tutorialSeen ?? prev.state.tutorialSeen,
                requiresOnboarding: body.state?.requiresOnboarding ?? prev.state.requiresOnboarding,
              },
            }
          : prev
      );
      setError("Complete all required fields to continue.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700">
        <div className="text-sm text-white/70">Loading onboarding...</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700">
        <div className="rounded-xl bg-white p-6 text-sm text-destructive">{error ?? "Could not load onboarding."}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 p-4 py-10">
      {!tutorialDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 className="font-bold text-brand-900">{TOUR_STEPS[tourStep].title}</h2>
                <p className="text-xs text-muted-foreground">{TOUR_STEPS[tourStep].body}</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Step {tourStep + 1} / {TOUR_STEPS.length}</p>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-muted"
                  onClick={() => setTourStep(TOUR_STEPS.length)}
                >
                  Skip
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
                  onClick={() => setTourStep((p) => Math.min(TOUR_STEPS.length, p + 1))}
                >
                  {tourStep >= TOUR_STEPS.length - 1 ? "Done" : "Next"}
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-brand-900">Complete your account setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill required business and profile details before you can use the portal.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Missing required fields: <strong>{missingFieldsLabel}</strong>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Field label="Name" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
          <Field
            label="Phone"
            type="tel"
            placeholder="0451217210 or +61451217210"
            value={form.phone}
            onChange={(v) => setForm((p) => ({ ...p, phone: v }))}
          />
          <div className="md:col-span-2">
            <Field label="Address" value={form.address} onChange={(v) => setForm((p) => ({ ...p, address: v }))} />
          </div>
        </div>

        {needsBusiness && (
          <>
            <hr className="my-6 border-border" />
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Business</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Business name" value={form.businessName} onChange={(v) => setForm((p) => ({ ...p, businessName: v }))} />
              <Field label="ABN" placeholder="11 digits" value={form.abn} onChange={(v) => setForm((p) => ({ ...p, abn: v }))} />
            </div>
          </>
        )}

        {needsBank && (
          <>
            <hr className="my-6 border-border" />
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Bank details</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Account name" value={form.accountName} onChange={(v) => setForm((p) => ({ ...p, accountName: v }))} />
              <Field label="Bank name" value={form.bankName} onChange={(v) => setForm((p) => ({ ...p, bankName: v }))} />
              <Field label="BSB" placeholder="123456" value={form.bsb} onChange={(v) => setForm((p) => ({ ...p, bsb: v }))} />
              <Field label="Account number" placeholder="6 to 10 digits" value={form.accountNumber} onChange={(v) => setForm((p) => ({ ...p, accountNumber: v }))} />
            </div>
          </>
        )}

        <div className="mt-8 flex justify-end">
          <button
            className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
            disabled={saving || !tutorialDone}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}