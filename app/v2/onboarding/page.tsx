"use client";

/**
 * Estate-native onboarding — the profile-completion wizard new staff/clients see
 * after their first sign-in. Same contract as v1 (`GET`/`PATCH /api/me/onboarding`);
 * role-aware fields (business for CLIENT/LAUNDRY, bank for CLEANER/LAUNDRY). On
 * completion routes into the v2 portal home. No dependency on components/{ui,shared}.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { ECard, ECardBody, EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/admin/estate-kit";

type Resp = {
  user: { name: string | null; phone: string | null; role: "ADMIN" | "OPS_MANAGER" | "CLEANER" | "CLIENT" | "LAUNDRY" };
  extendedProfile?: {
    contactNumber?: string | null;
    address?: string | null;
    businessName?: string | null;
    abn?: string | null;
    bankDetails?: { accountName?: string | null; bankName?: string | null; bsb?: string | null; accountNumber?: string | null } | null;
  } | null;
  missingFields?: string[];
  state?: { requiresOnboarding?: boolean; tutorialSeen?: boolean };
};

const EMPTY = { name: "", phone: "", address: "", businessName: "", abn: "", accountName: "", bankName: "", bsb: "", accountNumber: "" };

export default function V2OnboardingPage() {
  const router = useRouter();
  const [data, setData] = useState<Resp | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = data?.user.role;
  const needsBusiness = role === "CLIENT" || role === "LAUNDRY";
  const needsBank = role === "CLEANER" || role === "LAUNDRY";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me/onboarding", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Resp;
        setData(body);
        setForm({
          name: body.user?.name ?? "",
          phone: body.extendedProfile?.contactNumber ?? body.user?.phone ?? "",
          address: body.extendedProfile?.address ?? "",
          businessName: body.extendedProfile?.businessName ?? "",
          abn: body.extendedProfile?.abn ?? "",
          accountName: body.extendedProfile?.bankDetails?.accountName ?? "",
          bankName: body.extendedProfile?.bankDetails?.bankName ?? "",
          bsb: body.extendedProfile?.bankDetails?.bsb ?? "",
          accountNumber: body.extendedProfile?.bankDetails?.accountNumber ?? "",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const missingLabel = useMemo(() => {
    if (!data?.missingFields?.length) return null;
    const labels = data.missingFields.map((f) =>
      f === "contactNumber" ? "phone" : f === "bankDetails" ? "bank details" : f === "businessName" ? "business name" : f
    );
    return Array.from(new Set(labels)).join(", ");
  }, [data?.missingFields]);

  function set(k: keyof typeof EMPTY, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
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
            ? { accountName: form.accountName, bankName: form.bankName, bsb: form.bsb, accountNumber: form.accountNumber }
            : undefined,
          tutorialSeen: true,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        setError(body.error ?? "Could not save. Please try again.");
        return;
      }
      if (!body.onboardingComplete) {
        setData((prev) => (prev ? { ...prev, missingFields: body.missingFields ?? prev.missingFields } : prev));
        setError("Please complete all required fields to continue.");
        return;
      }
      router.push("/v2");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10">
      <ECard variant="ceremony" className="w-full">
        <ECardBody className="space-y-6 p-8">
          <div>
            <EEyebrow>Welcome to sNeek</EEyebrow>
            <h1 className="e-display-sm mt-1">Complete your profile</h1>
            <p className="mt-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              A few details before you get started.
              {missingLabel ? <span className="text-[hsl(var(--e-danger))]"> Still needed: {missingLabel}.</span> : null}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Full name *">
                  <EInput value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" />
                </EField>
                <EField label="Phone *">
                  <EInput value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="04xx xxx xxx" />
                </EField>
              </div>
              <EField label="Address">
                <EInput value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, suburb, state, postcode" />
              </EField>

              {needsBusiness ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <EField label="Business name">
                    <EInput value={form.businessName} onChange={(e) => set("businessName", e.target.value)} />
                  </EField>
                  <EField label="ABN">
                    <EInput value={form.abn} onChange={(e) => set("abn", e.target.value)} />
                  </EField>
                </div>
              ) : null}

              {needsBank ? (
                <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
                  <p className="flex items-center gap-2 text-[0.8125rem] font-[600]">
                    <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" /> Payment details (for your invoices)
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <EField label="Account name">
                      <EInput value={form.accountName} onChange={(e) => set("accountName", e.target.value)} />
                    </EField>
                    <EField label="Bank name">
                      <EInput value={form.bankName} onChange={(e) => set("bankName", e.target.value)} />
                    </EField>
                    <EField label="BSB">
                      <EInput value={form.bsb} onChange={(e) => set("bsb", e.target.value)} />
                    </EField>
                    <EField label="Account number">
                      <EInput value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
                    </EField>
                  </div>
                </div>
              ) : null}

              {error ? (
                <p className="rounded-[var(--e-radius)] border-l-2 border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.06)] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
                  {error}
                </p>
              ) : null}

              <EButton variant="gold" size="lg" className="w-full" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Finish & enter sNeek"}
              </EButton>
            </div>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
