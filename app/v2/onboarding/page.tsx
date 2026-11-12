"use client";

/**
 * Estate onboarding — the profile-completion steps new staff and clients see
 * after their first sign-in (board "Public and sign in", screen 3).
 *
 * Same contract as before (`GET`/`PATCH /api/me/onboarding`, same body); only
 * the layout changed: one section per step, role-aware (business for CLIENT
 * and LAUNDRY, bank for CLEANER and LAUNDRY), ending on Finish. Finish offers
 * the existing passkey registration — the person is signed in here, so the
 * session the registration endpoints require exists. Completion is decided by
 * the server; a missing field sends the person back to its step.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { EAlert, EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { EstateLoader } from "@/components/v2/ui/estate-loader";
import { EPasskeySection } from "@/components/v2/shared/passkey-section";
import { OnboardingFields, EMPTY_ONBOARDING_FORM, type OnboardingForm } from "@/components/v2/onboarding/onboarding-fields";
import { firstStepWithMissing, onboardingSteps, roleNeedsBank, roleNeedsBusiness } from "@/lib/onboarding/steps";

type OnboardingResponse = {
  user: { name: string | null; phone: string | null; role: string };
  extendedProfile?: {
    contactNumber?: string | null;
    address?: string | null;
    businessName?: string | null;
    abn?: string | null;
    bankDetails?: { accountName?: string | null; bankName?: string | null; bsb?: string | null; accountNumber?: string | null } | null;
  } | null;
  missingFields?: string[];
};

type SaveResponse = { error?: string; onboardingComplete?: boolean; missingFields?: string[] };

function fieldLabel(field: string): string {
  if (field === "contactNumber") return "phone";
  if (field === "bankDetails") return "bank details";
  if (field === "businessName") return "business name";
  return field;
}

export default function V2OnboardingPage() {
  const router = useRouter();
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [form, setForm] = useState<OnboardingForm>({ ...EMPTY_ONBOARDING_FORM });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const role = data?.user.role;
  const needsBusiness = roleNeedsBusiness(role);
  const needsBank = roleNeedsBank(role);
  const steps = useMemo(() => onboardingSteps(role), [role]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/me/onboarding", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as OnboardingResponse | null;
      if (!res.ok || !body?.user) {
        setLoadError("Your details could not be loaded.");
        return;
      }
      setData(body);
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
    } catch {
      setLoadError("Your details could not be loaded. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const missingLabel = useMemo(() => {
    if (!data?.missingFields?.length) return null;
    return Array.from(new Set(data.missingFields.map(fieldLabel))).join(", ");
  }, [data?.missingFields]);

  function set(key: keyof OnboardingForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function goTo(index: number) {
    setError(null);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, index)));
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
      const body = (await res.json().catch(() => ({}))) as SaveResponse;
      if (!res.ok) {
        setError(body.error ?? "Could not save. Please try again.");
        return;
      }
      if (!body.onboardingComplete) {
        const missing = body.missingFields ?? data?.missingFields ?? [];
        setData((prev) => (prev ? { ...prev, missingFields: missing } : prev));
        const target = firstStepWithMissing(steps, missing);
        if (target) setStepIndex(steps.findIndex((entry) => entry.key === target));
        setError("Please complete all required fields to continue.");
        return;
      }
      router.push("/v2");
      router.refresh();
    } catch {
      setError("Could not save while offline. Your answers are still here; try again.");
    } finally {
      setSaving(false);
    }
  }

  const stageStates = steps.map((entry, index) => ({
    key: entry.key,
    label: entry.label,
    state: index < stepIndex ? ("passed" as const) : index === stepIndex ? ("current" as const) : ("todo" as const),
  }));
  const isLast = step?.key === "finish";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10">
      <ECard variant="ceremony" className="w-full">
        <ECardBody className="space-y-5 p-6 sm:p-8">
          <div className="flex items-start gap-2">
            {stepIndex > 0 ? (
              <EButton variant="ghost" size="icon" aria-label="Previous step" onClick={() => goTo(stepIndex - 1)} disabled={saving}>
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </EButton>
            ) : null}
            <div className="min-w-0 flex-1">
              <EEyebrow>Welcome to sNeek</EEyebrow>
              <h1 className="e-display-sm mt-1">Set up your account</h1>
              {!loading && !loadError ? (
                <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  Step {stepIndex + 1} of {steps.length}
                  {missingLabel ? <span className="text-[hsl(var(--e-danger))]"> · Still needed: {missingLabel}.</span> : null}
                </p>
              ) : null}
            </div>
          </div>

          {loading ? (
            <EstateLoader size="inline" label="Loading" className="py-8" />
          ) : loadError ? (
            <div role="alert">
              <EAlert tone="danger" title={loadError}>
                <button type="button" className="font-[550] underline" onClick={() => void load()}>Retry</button>
              </EAlert>
            </div>
          ) : (
            <div className="space-y-5">
              <EStageBar label="Setup steps" stages={stageStates} />
              <fieldset disabled={saving} className="space-y-5">
                {step && step.key !== "finish" ? <OnboardingFields step={step.key} form={form} onChange={set} /> : null}
                {isLast ? (
                  <div className="space-y-4">
                    <h2 className="text-[1rem] font-[600]">Ready when you are</h2>
                    <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                      Finishing saves your details. You can change them later from your profile.
                    </p>
                    {/* Optional: the existing passkey registration (renders nothing without a passkey authenticator). */}
                    <EPasskeySection />
                  </div>
                ) : null}
              </fieldset>

              {error ? (
                <p role="alert" className="rounded-[var(--e-radius)] border-l-2 border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.06)] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
                  {error}
                </p>
              ) : null}

              {isLast ? (
                <EButton variant="gold" size="lg" className="w-full" onClick={() => void save()} disabled={saving}>
                  {saving ? "Saving…" : "Finish & enter sNeek"}
                </EButton>
              ) : (
                <EButton variant="gold" size="lg" className="w-full" onClick={() => goTo(stepIndex + 1)}>
                  Next: {steps[stepIndex + 1]?.label.toLowerCase()}
                </EButton>
              )}
            </div>
          )}
        </ECardBody>
      </ECard>
    </main>
  );
}
