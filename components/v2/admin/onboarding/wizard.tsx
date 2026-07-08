"use client";

/**
 * ESTATE onboarding wizard — v2-native port of the v1 wizard
 * (app/admin/onboarding/new/page.tsx + components/onboarding/wizard-layout.tsx).
 * Same endpoints and payloads:
 *   POST  /api/admin/onboarding/surveys                  {} → create a DRAFT survey
 *   GET   /api/admin/onboarding/surveys/[id]             → prefill for ?edit=<id>
 *   PATCH /api/admin/onboarding/surveys/[id]             merged formData per step (updateSurveySchema)
 *   POST  /api/admin/onboarding/surveys/[id]/submit      → PENDING_REVIEW
 * plus estimate / ical-validate / checklist endpoints used inside steps.
 * Estate token scope only; no components/ui/* dependency.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Loader2, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle, EEyebrow } from "@/components/v2/ui/primitives";
import { PropertyChecklistProfile } from "@/components/v2/admin/properties/property-checklist-profile";
import {
  StepAccess,
  StepAppliances,
  StepClient,
  StepIcal,
  StepJobTypes,
  StepLaundry,
  StepNotes,
  StepPropertyBasics,
  StepRequests,
  StepScenarios,
  StepStaffing,
} from "./wizard-steps";

const STEPS: { id: string; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "property", label: "Property Basics" },
  { id: "access", label: "Access" },
  { id: "jobtypes", label: "Cleaning Types" },
  { id: "appliances", label: "Rooms & Appliances" },
  { id: "laundry", label: "Laundry" },
  { id: "scenarios", label: "Scenarios & Consumables" },
  { id: "requests", label: "Special Requests" },
  { id: "notes", label: "Notes" },
  { id: "staffing", label: "Staffing & Estimate" },
  { id: "ical", label: "Schedule / iCal" },
  { id: "checklist", label: "Checklist Preview" },
  { id: "review", label: "Review" },
];

// Survey fields that never round-trip back into the wizard form blob.
const EDIT_EXCLUDED_KEYS = [
  "id",
  "surveyNumber",
  "sourceType",
  "status",
  "submittedById",
  "adminReviewerId",
  "reviewedAt",
  "rejectionReason",
  "createdAt",
  "updatedAt",
  "submittedAt",
  "createdClientId",
  "createdPropertyId",
  "createdIntegrationId",
  "createdLaundryTaskId",
  "createdJobIds",
  "existingClient",
  "createdClient",
  "submittedBy",
  "adminReviewer",
  "laundrySupplier",
  "adminOverrides",
  "appliances",
  "specialRequests",
  "accessDetails",
  "jobTypeAnswers",
  "laundryDetail",
  "clientData",
];

/* ── Step indicator (Estate pills over a hairline) ─────────────────────── */
function StepIndicator({
  currentStep,
  completedSteps,
  onStepClick,
}: {
  currentStep: string;
  completedSteps: string[];
  onStepClick: (stepId: string) => void;
}) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex min-w-[640px] items-center gap-1 px-1">
        {STEPS.map((step, i) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = step.id === currentStep;
          const isPast = i < currentIndex;
          const clickable = isCompleted || isPast || isCurrent;

          return (
            <div key={step.id} className="flex items-center">
              <button
                type="button"
                onClick={() => clickable && onStepClick(step.id)}
                disabled={!clickable}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-[600] transition-colors duration-[160ms] ${
                  isCompleted
                    ? "bg-[hsl(var(--e-success))] text-white"
                    : isCurrent
                      ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))] ring-2 ring-[hsl(var(--e-ring))] ring-offset-2 ring-offset-[hsl(var(--e-background))]"
                      : isPast
                        ? "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]"
                        : "cursor-not-allowed bg-[hsl(var(--e-muted)/0.5)] text-[hsl(var(--e-text-faint))]"
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </button>
              <span
                className={`ml-1.5 whitespace-nowrap text-[0.6875rem] ${
                  isCurrent
                    ? "font-[600] text-[hsl(var(--e-foreground))]"
                    : isCompleted
                      ? "text-[hsl(var(--e-success))]"
                      : "text-[hsl(var(--e-muted-foreground))]"
                }`}
              >
                {step.label}
              </span>
              {i < STEPS.length - 1 ? (
                <div
                  className={`mx-1 h-px w-4 shrink-0 ${
                    isPast || isCompleted ? "bg-[hsl(var(--e-success))]" : "bg-[hsl(var(--e-border))]"
                  }`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Review step (summary cards + submit) ──────────────────────────────── */
function StepReview({
  surveyId,
  data,
  onComplete,
}: {
  surveyId: string;
  data: Record<string, unknown>;
  onComplete: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function submitForReview() {
    if (!data.existingClientId && !data.isNewClient) {
      toast({
        title: "Client required",
        description: "Link an existing client or create a new one.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${surveyId}/submit`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to submit");
      }
      toast({ title: "Submitted for review" });
      onComplete();
      router.push("/v2/admin/onboarding");
    } catch (err: any) {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const clientData = (data.clientData as Record<string, unknown>) ?? {};
  const laundryDetail = (data.laundryDetail as Record<string, unknown>) ?? {};
  const scenarios = (data.scenarios as Record<string, any>) ?? {};
  const schedule = (data.recurringSchedule as Record<string, any>) ?? {};
  const contact = (data.emergencyContact as Record<string, any>) ?? {};
  const hasGeo = typeof data.propertyLatitude === "number" && typeof data.propertyLongitude === "number";

  const sections: { title: string; items: (string | null | undefined)[] }[] = [
    {
      title: "Client",
      items: data.isNewClient
        ? [
            `New: ${String(clientData.name ?? "Unnamed")}`,
            clientData.email ? String(clientData.email) : null,
            clientData.phone ? String(clientData.phone) : null,
          ]
        : [`Existing client: ${data.existingClientId ?? "Not linked"}`],
    },
    {
      title: "Property",
      items: [
        data.propertyName ? String(data.propertyName) : null,
        data.propertyAddress ? String(data.propertyAddress) : null,
        data.propertySuburb ? String(data.propertySuburb) : null,
        `${data.bedrooms ?? 1} bed, ${data.bathrooms ?? 1} bath`,
        data.propertyType ? String(data.propertyType) : null,
        data.sizeSqm ? `${data.sizeSqm} sqm` : null,
        scenarios.bedConfig ? `Beds: ${scenarios.bedConfig}` : null,
        hasGeo ? "Location pinned for maps/GPS" : "Address will be geocoded on approval",
      ],
    },
    {
      title: "Cleaning Types",
      items: ((data.selectedJobTypes as string[]) ?? []).map((jt) => jt.replace(/_/g, " ")),
    },
    {
      title: "Appliances",
      items: ((data.appliances as any[]) ?? []).map((a) => `${a.applianceType}${a.requiresClean ? " (clean)" : ""}`),
    },
    {
      title: "Special Requests",
      items: ((data.specialRequests as any[]) ?? []).map((r) => `[${r.priority}] ${r.description}`),
    },
    {
      title: "Laundry",
      items:
        laundryDetail.hasLaundry === true
          ? ["Laundry enabled", data.laundrySupplierId ? "Partner assigned" : "No partner assigned"]
          : ["No laundry"],
    },
    {
      title: "Access Details",
      items: ((data.accessDetails as any[]) ?? []).map(
        (d) => `${String(d.detailType).replace(/_/g, " ")}: ${d.value || (d.photoUrl ? "Photo added" : "N/A")}`,
      ),
    },
    {
      title: "Staffing",
      items: [
        `Requested: ${data.requestedCleanerCount ?? 1} cleaner(s)`,
        data.estimatedHours ? `Estimated: ${data.estimatedHours}h` : null,
        data.estimatedPrice ? `Est. price: $${Number(data.estimatedPrice).toFixed(2)}` : null,
      ],
    },
    {
      title: "Scenarios & Consumables",
      items: [
        scenarios.hasPets ? `Pets: ${scenarios.petDetails ?? "yes"}` : null,
        scenarios.hasAlarm ? "Has alarm" : null,
        scenarios.wifiNetwork ? `Wifi: ${scenarios.wifiNetwork}` : null,
        scenarios.binDay ? `Bins: ${scenarios.binDay}` : null,
        scenarios.consumablesProvided ? "We restock consumables" : null,
        scenarios.linenSets != null ? `Linen sets: ${scenarios.linenSets}` : null,
        scenarios.noGoAreas ? `No-go: ${scenarios.noGoAreas}` : null,
      ],
    },
    {
      title: "Schedule & iCal",
      items: [
        data.defaultCheckinTime ? `Check-in ${data.defaultCheckinTime}` : null,
        data.defaultCheckoutTime ? `Check-out ${data.defaultCheckoutTime}` : null,
        schedule.enabled ? `Recurring: ${schedule.cadence ?? "—"}` : null,
        data.icalUrl ? `iCal: ${data.icalUrl}` : "No iCal feed",
      ],
    },
    {
      title: "Emergency / Owner Contact",
      items: [
        contact.name ? `${contact.name}${contact.relation ? ` (${contact.relation})` : ""}` : null,
        contact.phone ?? null,
        contact.email ?? null,
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Review all collected information before submitting for admin review.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => {
          const items = section.items.filter((i): i is string => typeof i === "string" && i.trim().length > 0);
          return (
            <ECard key={section.title}>
              <ECardHeader className="pb-2">
                <ECardTitle className="text-[0.8125rem]">{section.title}</ECardTitle>
              </ECardHeader>
              <ECardBody className="pt-0">
                {items.length > 0 ? (
                  <ul className="space-y-1 text-[0.8125rem]">
                    {items.map((item, i) => (
                      <li key={i} className="text-[hsl(var(--e-muted-foreground))]">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">None</p>
                )}
              </ECardBody>
            </ECard>
          );
        })}
      </div>

      <div className="flex justify-end gap-2">
        <EButton variant="gold" onClick={() => void submitForReview()} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit for Review
        </EButton>
      </div>
    </div>
  );
}

/* ── Wizard shell ──────────────────────────────────────────────────────── */
export function OnboardingWizard({ editId }: { editId?: string }) {
  const router = useRouter();
  const [surveyId, setSurveyId] = React.useState<string | null>(null);
  const [currentStep, setCurrentStep] = React.useState(STEPS[0].id);
  const [completedSteps, setCompletedSteps] = React.useState<string[]>([]);
  const [formData, setFormData] = React.useState<Record<string, unknown>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (editId) {
      fetch(`/api/admin/onboarding/surveys/${editId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.id) {
            setSurveyId(data.id);
            const mapped: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
              if (EDIT_EXCLUDED_KEYS.includes(key)) continue;
              mapped[key] = value;
            }
            if (data.clientData) mapped.clientData = data.clientData;
            if (data.appliances) mapped.appliances = data.appliances;
            if (data.specialRequests) mapped.specialRequests = data.specialRequests;
            if (data.laundryDetail) mapped.laundryDetail = data.laundryDetail;
            if (data.accessDetails) mapped.accessDetails = data.accessDetails;
            if (data.jobTypeAnswers) mapped.jobTypeAnswers = data.jobTypeAnswers;
            // Re-hydrate the structured formMeta envelope back to top-level keys
            // (geocode, selectedJobTypes, scenarios, schedule, contact, times)
            // so the wizard steps repopulate when editing a draft.
            const formMeta = (
              data.adminOverrides && typeof data.adminOverrides === "object"
                ? (data.adminOverrides as Record<string, unknown>).formMeta
                : null
            ) as Record<string, unknown> | null;
            if (formMeta && typeof formMeta === "object") {
              for (const [k, v] of Object.entries(formMeta)) {
                if (v !== undefined && v !== null) mapped[k] = v;
              }
            }
            setFormData(mapped);
          } else {
            toast({ title: "Survey not found", variant: "destructive" });
            router.push("/v2/admin/onboarding");
          }
        })
        .catch(() => {
          toast({ title: "Failed to load survey", variant: "destructive" });
          router.push("/v2/admin/onboarding");
        })
        .finally(() => setLoading(false));
    } else {
      fetch("/api/admin/onboarding/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.id) {
            setSurveyId(data.id);
          } else {
            toast({ title: "Failed to create survey", variant: "destructive" });
          }
        })
        .catch(() => toast({ title: "Failed to create survey", variant: "destructive" }))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const saveStep = React.useCallback(
    async (stepId: string) => {
      if (!surveyId) return false;
      try {
        const res = await fetch(`/api/admin/onboarding/surveys/${surveyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to save");
        }
        setCompletedSteps((prev) => (prev.includes(stepId) ? prev : [...prev, stepId]));
        return true;
      } catch (err: any) {
        toast({ title: "Save failed", description: err.message, variant: "destructive" });
        return false;
      }
    },
    [surveyId, formData],
  );

  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  const handleNext = async () => {
    if (currentIndex >= STEPS.length - 1) return;
    const ok = await saveStep(currentStep);
    if (ok) setCurrentStep(STEPS[currentIndex + 1].id);
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    const ok = await saveStep(currentStep);
    if (ok) toast({ title: "Draft saved" });
    setSaving(false);
  };

  if (loading || !surveyId) {
    return (
      <p className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {editId ? "Loading survey…" : "Creating survey…"}
      </p>
    );
  }

  const stepComponents: Record<string, React.ReactNode> = {
    client: <StepClient data={formData} onChange={setFormData} />,
    property: <StepPropertyBasics data={formData} onChange={setFormData} />,
    access: <StepAccess data={formData} onChange={setFormData} />,
    jobtypes: <StepJobTypes data={formData} onChange={setFormData} />,
    appliances: <StepAppliances data={formData} onChange={setFormData} />,
    laundry: <StepLaundry data={formData} onChange={setFormData} />,
    scenarios: <StepScenarios data={formData} onChange={setFormData} />,
    requests: <StepRequests data={formData} onChange={setFormData} />,
    notes: <StepNotes data={formData} onChange={setFormData} />,
    staffing: <StepStaffing data={formData} onChange={setFormData} />,
    ical: <StepIcal data={formData} onChange={setFormData} />,
    checklist: (
      <div className="space-y-4">
        <div className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Review the checklist this property&apos;s cleaner form will use. Amenities came from the Rooms &amp;
          Appliances step — anything the property doesn&apos;t have (no dishwasher, no oven, no balcony) is already
          switched off. Use <span className="font-[600] text-[hsl(var(--e-foreground))]">Save draft</span> inside the
          builder to keep your edits; the property-specific form is generated automatically when this onboarding is
          approved.
        </div>
        <PropertyChecklistProfile
          propertyId={surveyId}
          apiBase={`/api/admin/onboarding/surveys/${surveyId}/checklist`}
          mode="survey"
        />
      </div>
    ),
    review: (
      <StepReview
        surveyId={surveyId}
        data={formData}
        onComplete={() => setCompletedSteps((prev) => [...prev, "review"])}
      />
    ),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="sm">
          <Link href="/v2/admin/onboarding">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </EButton>
        <div className="flex-1" />
        <EButton variant="outline" size="sm" onClick={() => void handleSaveDraft()} disabled={saving}>
          <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save Draft"}
        </EButton>
      </div>

      <StepIndicator currentStep={currentStep} completedSteps={completedSteps} onStepClick={setCurrentStep} />

      <ECard>
        <ECardHeader className="pb-3">
          <EEyebrow>Onboarding</EEyebrow>
          <ECardTitle>{STEPS[currentIndex]?.label}</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Step {currentIndex + 1} of {STEPS.length}
          </p>
        </ECardHeader>
        <ECardBody className="pt-0">{stepComponents[currentStep]}</ECardBody>
      </ECard>

      <div className="flex items-center justify-between">
        <EButton
          variant="outline"
          onClick={() => currentIndex > 0 && setCurrentStep(STEPS[currentIndex - 1].id)}
          disabled={currentIndex === 0}
        >
          <ArrowLeft className="h-4 w-4" /> Previous
        </EButton>
        <EButton onClick={() => void handleNext()} disabled={currentIndex >= STEPS.length - 1}>
          {currentIndex >= STEPS.length - 2 ? (
            <>
              Review &amp; Submit <ArrowRight className="h-4 w-4" />
            </>
          ) : (
            <>
              Next <ArrowRight className="h-4 w-4" />
            </>
          )}
        </EButton>
      </div>
    </div>
  );
}
