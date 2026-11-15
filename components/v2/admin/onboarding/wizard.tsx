"use client";

import { useRestorableState } from "@/hooks/use-restorable-state";

/**
 * ESTATE onboarding wizard — v2-native port of the v1 wizard
 * (app/admin/onboarding/new/page.tsx + components/onboarding/wizard-layout.tsx).
 * Same endpoints and payloads:
 *   POST  /api/admin/onboarding/surveys                  formData + Idempotency-Key → create the DRAFT
 *         on the FIRST SAVE (2026-11-14): never on opening the page. The first
 *         autosave after the person enters something (or Next / Save Draft
 *         with something entered) creates it, then the URL becomes
 *         ?edit=<id> so reload and resume work. A failed first save keeps
 *         every answer on the page and offers Retry with the same key.
 *   GET   /api/admin/onboarding/surveys/[id]             → prefill for ?edit=<id>
 *   PATCH /api/admin/onboarding/surveys/[id]             merged formData per step (updateSurveySchema)
 *   POST  /api/admin/onboarding/surveys/[id]/submit      → PENDING_REVIEW
 * plus estimate / ical-validate / checklist endpoints used inside steps.
 * Estate token scope only; no components/ui/* dependency.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle, EEyebrow } from "@/components/v2/ui/primitives";
import { PropertyChecklistProfile } from "@/components/v2/admin/properties/property-checklist-profile";
import {
  ONBOARDING_DRAFT_KEY_HEADER,
  ONBOARDING_FIRST_SAVE_DELAY_MS,
  describeOnboardingSaveError,
  hasOnboardingDraftContent,
  newOnboardingDraftKey,
} from "@/lib/onboarding/wizard-draft";
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

type SurveyFormData = Record<string, unknown>;

/** Where the new survey's draft is: not made yet, being made, failed (answers kept), or saved. */
type DraftCreation =
  | { phase: "not-created" }
  | { phase: "creating" }
  | { phase: "failed"; message: string }
  | { phase: "created" };

/** What a step save did: saved to the draft, nothing entered yet, or failed. */
type StepSaveResult = "saved" | "nothing-to-save" | "failed";

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

/* ── First-save status (new surveys only) ──────────────────────────────── */
function FirstDraftStatus({
  creation,
  hasContent,
  onRetry,
}: {
  creation: DraftCreation;
  hasContent: boolean;
  onRetry: () => void;
}) {
  if (creation.phase === "created") return null;
  if (creation.phase === "failed") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger)/0.06)] px-3 py-2 text-[0.8125rem]"
      >
        <span className="min-w-0 flex-1">
          Draft not saved yet: {creation.message} Your answers are kept on this page.
        </span>
        <EButton variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" /> Retry
        </EButton>
      </div>
    );
  }
  return (
    <p role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
      {creation.phase === "creating"
        ? "Saving draft…"
        : hasContent
          ? "Not saved yet. The draft is saved in a moment."
          : "Nothing is saved until you enter something. The draft is created on your first save."}
    </p>
  );
}

/* ── Wizard shell ──────────────────────────────────────────────────────── */
export function OnboardingWizard({ editId }: { editId?: string }) {
  const router = useRouter();
  const [surveyId, setSurveyId] = React.useState<string | null>(null);
  const [currentStep, setCurrentStep] = useRestorableState("wizard:currentStep", STEPS[0].id);
  const [completedSteps, setCompletedSteps] = React.useState<string[]>([]);
  const [formData, setFormData] = React.useState<SurveyFormData>({});
  const [loading, setLoading] = React.useState(Boolean(editId));
  const [saving, setSaving] = React.useState(false);
  const [creation, setCreation] = React.useState<DraftCreation>(
    editId ? { phase: "created" } : { phase: "not-created" },
  );

  const mountedRef = React.useRef(true);
  const surveyIdRef = React.useRef<string | null>(null);
  // One key per wizard: every retry of the first save reuses it, so an
  // uncertain failure can never leave two drafts behind.
  const draftKeyRef = React.useRef<string>(newOnboardingDraftKey());
  const createRequestRef = React.useRef<Promise<string | null> | null>(null);
  const createdFromRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    // The draft this wizard just created: its ?edit= URL needs no reload, and
    // re-reading it would overwrite anything typed since the first save.
    if (editId && editId === surveyIdRef.current) return;
    if (!editId) {
      // Opened as a NEW survey after another one: start blank, with a new key.
      if (surveyIdRef.current) {
        surveyIdRef.current = null;
        createdFromRef.current = null;
        draftKeyRef.current = newOnboardingDraftKey();
        setSurveyId(null);
        setFormData({});
        setCompletedSteps([]);
        setCreation({ phase: "not-created" });
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/onboarding/surveys/${encodeURIComponent(editId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.id) {
          surveyIdRef.current = data.id;
          setSurveyId(data.id);
          setCreation({ phase: "created" });
          const mapped: SurveyFormData = {};
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
        if (cancelled) return;
        toast({ title: "Failed to load survey", variant: "destructive" });
        router.push("/v2/admin/onboarding");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  /**
   * Creates the draft from what has been entered (first save only). Shares one
   * request between the autosave, Next and Save Draft; a failure keeps the
   * answers on the page and the same idempotency key for Retry.
   */
  const createDraft = React.useCallback(
    (snapshot: SurveyFormData): Promise<string | null> => {
      if (surveyIdRef.current) return Promise.resolve(surveyIdRef.current);
      if (createRequestRef.current) return createRequestRef.current;
      setCreation({ phase: "creating" });
      const request = (async () => {
        try {
          const res = await fetch("/api/admin/onboarding/surveys", {
            method: "POST",
            headers: { "Content-Type": "application/json", [ONBOARDING_DRAFT_KEY_HEADER]: draftKeyRef.current },
            body: JSON.stringify(snapshot),
          });
          const body = await res.json().catch(() => ({}));
          if (!mountedRef.current) return null;
          if (!res.ok || typeof body.id !== "string") {
            throw new Error(describeOnboardingSaveError(body.error, "The draft could not be saved."));
          }
          surveyIdRef.current = body.id;
          createdFromRef.current = JSON.stringify(snapshot);
          setSurveyId(body.id);
          setCreation({ phase: "created" });
          // The resume URL the board and detail page link to.
          router.replace(`/v2/admin/onboarding/new?edit=${encodeURIComponent(body.id)}`);
          return body.id as string;
        } catch (err) {
          if (!mountedRef.current) return null;
          const message = err instanceof Error ? err.message : "The draft could not be saved.";
          setCreation({ phase: "failed", message });
          return null;
        } finally {
          createRequestRef.current = null;
        }
      })();
      createRequestRef.current = request;
      return request;
    },
    [router],
  );

  // First autosave: once something has been entered, and only until the draft exists.
  React.useEffect(() => {
    if (editId || surveyIdRef.current) return;
    if (!hasOnboardingDraftContent(formData)) return;
    const timer = window.setTimeout(() => {
      void createDraft(formData);
    }, ONBOARDING_FIRST_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [editId, formData, createDraft]);

  // Answers that are not in any draft yet: warn before the tab closes.
  const unsavedFirstDraft = !surveyId && creation.phase !== "created" && hasOnboardingDraftContent(formData);
  React.useEffect(() => {
    if (!unsavedFirstDraft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsavedFirstDraft]);

  const saveStep = React.useCallback(
    async (stepId: string): Promise<StepSaveResult> => {
      const markCompleted = () => setCompletedSteps((prev) => (prev.includes(stepId) ? prev : [...prev, stepId]));
      let id = surveyIdRef.current;
      if (!id) {
        if (!hasOnboardingDraftContent(formData)) return "nothing-to-save";
        id = await createDraft(formData);
        if (!id) return "failed";
        // The create carried exactly these answers: nothing more to send.
        if (createdFromRef.current === JSON.stringify(formData)) {
          markCompleted();
          return "saved";
        }
      }
      try {
        const res = await fetch(`/api/admin/onboarding/surveys/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(describeOnboardingSaveError(body.error, "Failed to save"));
        }
        markCompleted();
        return "saved";
      } catch (err) {
        toast({ title: "Save failed", description: err instanceof Error ? err.message : "Failed to save", variant: "destructive" });
        return "failed";
      }
    },
    [formData, createDraft],
  );

  const retryFirstSave = () => {
    void createDraft(formData);
  };

  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  const handleNext = async () => {
    if (currentIndex >= STEPS.length - 1) return;
    const result = await saveStep(currentStep);
    if (result !== "failed") setCurrentStep(STEPS[currentIndex + 1].id);
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    const result = await saveStep(currentStep);
    if (result === "saved") toast({ title: "Draft saved" });
    if (result === "nothing-to-save") toast({ title: "Nothing to save yet", description: "Enter some details first." });
    setSaving(false);
  };

  if (loading) {
    return (
      <p className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading survey…
      </p>
    );
  }

  const draftNotSavedNote = (
    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
      This step needs the saved draft. It is created as soon as you enter the client or property details.
    </p>
  );

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
    checklist: !surveyId ? draftNotSavedNote : (
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
    review: !surveyId ? draftNotSavedNote : (
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

      <FirstDraftStatus creation={creation} hasContent={hasOnboardingDraftContent(formData)} onRetry={retryFirstSave} />

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
