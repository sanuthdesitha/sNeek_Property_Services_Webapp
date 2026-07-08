"use client";

/**
 * ESTATE onboarding survey detail — v2-native port of the v1 review page
 * (app/admin/onboarding/[id]/page.tsx). Same endpoints and payloads:
 *   GET    /api/admin/onboarding/surveys/[id]            → survey + relations
 *   GET    /api/admin/onboarding/surveys/[id]/preview    → approval preview + validation
 *   POST   /api/admin/onboarding/surveys/[id]/approve    { adminNotes, adminOverrides } (approveSurveySchema)
 *   POST   /api/admin/onboarding/surveys/[id]/reject     { reason }
 *   DELETE /api/admin/onboarding/surveys/[id]
 *   POST   /api/admin/properties/[createdPropertyId]/amenities-link → client amenities survey URL
 * Estate token scope only; no components/ui/* dependency.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  MapPin,
  Pencil,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "gold";

const STATUS_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

interface PreviewResponse {
  canApprove: boolean;
  errors: string[];
  preview: {
    client: { action: string; name: string };
    property: {
      name: string;
      address: string | null;
      suburb: string | null;
      willGeocode: boolean;
      hasCoordinates: boolean;
      laundryEnabled: boolean;
    };
    integration: { provider: string; url: string } | null;
    laundryTask: { supplier: string | null } | null;
    jobs: string[];
    jobCount: number;
  };
  formMeta: Record<string, any>;
}

export function SurveyDetail({ id }: { id: string }) {
  const router = useRouter();
  const [survey, setSurvey] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [adminNotes, setAdminNotes] = React.useState("");
  const [rejectReason, setRejectReason] = React.useState("");
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null);
  const [overrideHours, setOverrideHours] = React.useState("");
  const [overrideCleaners, setOverrideCleaners] = React.useState("");
  const [overridePrice, setOverridePrice] = React.useState("");
  const [amenitiesLoading, setAmenitiesLoading] = React.useState(false);
  const [amenitiesUrl, setAmenitiesUrl] = React.useState<string | null>(null);

  const loadSurvey = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (data.id) {
        setSurvey(data);
        setAdminNotes(data.adminNotes ?? "");
      } else {
        toast({ title: "Survey not found", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to load survey", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadPreview = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${id}/preview`, { cache: "no-store" });
      if (res.ok) setPreview(await res.json());
    } catch {
      /* non-blocking */
    }
  }, [id]);

  React.useEffect(() => {
    void loadSurvey();
  }, [loadSurvey]);

  React.useEffect(() => {
    if (survey?.status === "PENDING_REVIEW") void loadPreview();
  }, [survey?.status, loadPreview]);

  async function handleApprove() {
    if (preview && !preview.canApprove) {
      toast({
        title: "Cannot approve",
        description: "Resolve the validation errors first.",
        variant: "destructive",
      });
      return;
    }
    setApproving(true);
    try {
      const adminOverrides: Record<string, number> = {};
      if (overrideHours) adminOverrides.estimatedHours = parseFloat(overrideHours);
      if (overrideCleaners) adminOverrides.cleanerCount = parseInt(overrideCleaners);
      if (overridePrice) adminOverrides.estimatedPrice = parseFloat(overridePrice);

      const res = await fetch(`/api/admin/onboarding/surveys/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminNotes: adminNotes || null,
          adminOverrides: Object.keys(adminOverrides).length ? adminOverrides : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Approval failed");
      toast({
        title: body.alreadyApproved ? "Already approved" : "Survey approved",
        description: body.alreadyApproved
          ? "Entities were already created — no duplicates made."
          : "Client, property, and jobs have been created.",
      });
      await loadSurvey();
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a rejection reason.",
        variant: "destructive",
      });
      return;
    }
    setRejecting(true);
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Rejection failed");
      }
      toast({ title: "Survey rejected" });
      await loadSurvey();
    } catch (err: any) {
      toast({ title: "Rejection failed", description: err.message, variant: "destructive" });
    } finally {
      setRejecting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete failed");
      }
      toast({ title: "Survey deleted" });
      router.push("/v2/admin/onboarding");
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function handleAmenitiesLink() {
    if (!survey?.createdPropertyId) return;
    setAmenitiesLoading(true);
    try {
      const res = await fetch(`/api/admin/properties/${survey.createdPropertyId}/amenities-link`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create the amenities link");
      setAmenitiesUrl(body.url);
      try {
        await navigator.clipboard.writeText(body.url);
        toast({ title: "Amenities survey link copied", description: "Valid for 14 days — share it with the client." });
      } catch {
        toast({ title: "Amenities survey link ready", description: "Copy it from the field below." });
      }
    } catch (err: any) {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    } finally {
      setAmenitiesLoading(false);
    }
  }

  if (loading) {
    return (
      <p className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (!survey) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Survey not found.</p>;
  }

  const meta = (survey.adminOverrides?.formMeta ?? {}) as Record<string, any>;
  const scenarios = (meta.scenarios ?? {}) as Record<string, any>;
  const schedule = (meta.recurringSchedule ?? {}) as Record<string, any>;
  const contact = (meta.emergencyContact ?? {}) as Record<string, any>;
  const selectedJobTypes: string[] = Array.isArray(meta.selectedJobTypes) ? meta.selectedJobTypes : [];

  const sections: { title: string; items: (string | null | undefined)[] }[] = [
    {
      title: "Client",
      items: survey.isNewClient
        ? [`New: ${survey.clientData?.name ?? "Unnamed"}`, survey.clientData?.email, survey.clientData?.phone]
        : [`Existing: ${survey.existingClient?.name ?? survey.existingClientId ?? "Unknown"}`],
    },
    {
      title: "Property",
      items: [
        survey.propertyName,
        survey.propertyAddress,
        [survey.propertySuburb, survey.propertyState, survey.propertyPostcode].filter(Boolean).join(" "),
        `${survey.bedrooms} bed · ${survey.bathrooms} bath`,
        survey.propertyType,
        survey.sizeSqm ? `${survey.sizeSqm} sqm` : null,
        survey.hasBalcony ? "Has balcony" : null,
        `${survey.floorCount} floor(s)`,
        scenarios.bedConfig ? `Beds: ${scenarios.bedConfig}` : null,
        typeof meta.propertyLatitude === "number"
          ? `Geo: ${meta.propertyLatitude.toFixed(5)}, ${meta.propertyLongitude.toFixed(5)}`
          : "No coordinates (will geocode on approval)",
      ],
    },
    {
      title: "Cleaning Types",
      items: selectedJobTypes.length
        ? selectedJobTypes.map((jt) => jt.replace(/_/g, " "))
        : (survey.jobTypeAnswers ?? []).map((a: any) => a.jobType.replace(/_/g, " ")),
    },
    {
      title: "Appliances",
      items: (survey.appliances ?? []).map(
        (a: any) =>
          `${a.applianceType.replace(/_/g, " ")}${a.requiresClean ? " (clean)" : ""}${
            a.conditionNote ? `: ${a.conditionNote}` : ""
          }`,
      ),
    },
    {
      title: "Laundry",
      items: survey.laundryDetail?.hasLaundry
        ? [
            "Enabled",
            survey.laundrySupplier
              ? `Partner: ${survey.laundrySupplier.name}`
              : survey.laundrySupplierId
                ? "Partner assigned"
                : "No partner assigned",
            survey.laundryDetail.washerType,
            survey.laundryDetail.dryerType,
            survey.laundryDetail.laundryLocation,
            scenarios.linenSets != null ? `Linen sets: ${scenarios.linenSets}` : null,
            scenarios.linenBufferSets != null ? `Buffer sets: ${scenarios.linenBufferSets}` : null,
            survey.laundryDetail.notes,
          ]
        : ["No laundry"],
    },
    {
      title: "Scenarios & Consumables",
      items: [
        scenarios.hasPets ? `Pets: ${scenarios.petDetails ?? "yes"}` : null,
        scenarios.hasAlarm ? `Alarm: ${scenarios.alarmNotes ?? "yes"}` : null,
        scenarios.wifiNetwork ? `Wifi: ${scenarios.wifiNetwork}` : null,
        scenarios.binDay ? `Bins: ${scenarios.binDay}` : null,
        scenarios.consumablesProvided ? "Consumables: we restock" : null,
        scenarios.restockExpectations ? `Restock: ${scenarios.restockExpectations}` : null,
        scenarios.noGoAreas ? `No-go: ${scenarios.noGoAreas}` : null,
        scenarios.parkingInstructions ? `Parking: ${scenarios.parkingInstructions}` : null,
        scenarios.timingInstructions ? `Timing: ${scenarios.timingInstructions}` : null,
        scenarios.specialNotes ? `Notes: ${scenarios.specialNotes}` : null,
      ],
    },
    {
      title: "Special Requests",
      items: (survey.specialRequests ?? []).map(
        (r: any) => `[${r.priority}] ${r.area ? r.area + ": " : ""}${r.description}`,
      ),
    },
    {
      title: "Access Details",
      items: (survey.accessDetails ?? []).map(
        (d: any) => `${d.detailType.replace(/_/g, " ")}: ${d.value ?? (d.photoUrl ? "Photo added" : "N/A")}`,
      ),
    },
    {
      title: "Schedule & iCal",
      items: [
        meta.defaultCheckinTime ? `Check-in ${meta.defaultCheckinTime}` : null,
        meta.defaultCheckoutTime ? `Check-out ${meta.defaultCheckoutTime}` : null,
        schedule.enabled ? `Recurring: ${schedule.cadence ?? "—"}` : null,
        survey.icalUrl ? `iCal: ${survey.icalUrl}` : "No iCal feed",
      ],
    },
    {
      title: "Staffing & Estimate",
      items: [
        `Requested: ${survey.requestedCleanerCount} cleaner(s)`,
        survey.estimatedHours ? `Estimated: ${survey.estimatedHours}h` : null,
        survey.estimatedCleanerCount ? `Suggested: ${survey.estimatedCleanerCount} cleaners` : null,
        survey.estimatedPrice ? `Est. price: $${survey.estimatedPrice.toFixed(2)}` : null,
      ],
    },
    {
      title: "Emergency / Owner Contact",
      items: [
        contact.name ? `${contact.name}${contact.relation ? ` (${contact.relation})` : ""}` : null,
        contact.phone,
        contact.email,
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <EButton asChild variant="ghost" size="sm">
          <Link href="/v2/admin/onboarding">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </EButton>
        <div className="flex-1" />
        {survey.status === "DRAFT" ? (
          <EButton asChild variant="outline" size="sm">
            <Link href={`/v2/admin/onboarding/new?edit=${survey.id}`}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Link>
          </EButton>
        ) : null}
        {survey.status === "DRAFT" || survey.status === "REJECTED" ? (
          <EButton variant="ghost" size="icon" aria-label="Delete survey" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          </EButton>
        ) : null}
        <EBadge tone={STATUS_TONES[survey.status] ?? "neutral"} soft>
          {STATUS_LABELS[survey.status] ?? survey.status}
        </EBadge>
      </div>

      {/* ── Heading ── */}
      <div>
        <EEyebrow>Onboarding</EEyebrow>
        <h2 className="e-display-md mt-1">{survey.surveyNumber}</h2>
        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {survey.propertyName ?? survey.propertyAddress ?? "No property name"}
          {survey.propertySuburb ? ` — ${survey.propertySuburb}` : ""}
          {" · "}Created {format(new Date(survey.createdAt), "dd MMM yyyy")}
        </p>
      </div>

      {/* ── Captured data ── */}
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

      {survey.status === "PENDING_REVIEW" ? (
        <>
          {/* ── Preview of what approval creates ── */}
          {preview ? (
            <ECard variant="ceremony">
              <ECardHeader className="pb-2">
                <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
                  <Sparkles className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
                  On approval, this will create
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="space-y-2 pt-0 text-[0.8125rem]">
                <div className="flex flex-wrap gap-2">
                  <EBadge tone="neutral" soft>
                    {preview.preview.client.action === "create" ? "New client" : "Linked client"}:{" "}
                    {preview.preview.client.name}
                  </EBadge>
                  <EBadge tone="neutral" soft>
                    Property: {preview.preview.property.name}
                  </EBadge>
                  {preview.preview.integration ? (
                    <EBadge tone="neutral" soft>
                      iCal integration
                    </EBadge>
                  ) : null}
                  {preview.preview.laundryTask ? (
                    <EBadge tone="neutral" soft>
                      Laundry task
                    </EBadge>
                  ) : null}
                  <EBadge tone="neutral" soft>
                    {preview.preview.jobCount} job draft(s)
                  </EBadge>
                </div>
                {preview.preview.jobs.length > 0 ? (
                  <p className="text-[hsl(var(--e-muted-foreground))]">Jobs: {preview.preview.jobs.join(", ")}</p>
                ) : null}
                <p className="flex items-center gap-1 text-[hsl(var(--e-muted-foreground))]">
                  <MapPin className="h-3.5 w-3.5" />
                  {preview.preview.property.hasCoordinates
                    ? "Property already geocoded."
                    : preview.preview.property.willGeocode
                      ? "Address will be geocoded on approval."
                      : "No address to geocode — maps/GPS may be limited."}
                </p>
              </ECardBody>
            </ECard>
          ) : null}

          {/* ── Validation errors ── */}
          {preview && preview.errors.length > 0 ? (
            <EAlert
              tone="danger"
              title={
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Resolve before approving
                </span>
              }
            >
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {preview.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </EAlert>
          ) : null}

          {/* ── Review actions ── */}
          <ECard>
            <ECardHeader>
              <ECardTitle className="text-[0.95rem]">Admin review</ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-4 pt-0">
              <EField label="Admin notes (visible to cleaners on the job)">
                <ETextarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Notes visible to cleaners on the job"
                />
              </EField>

              <div className="grid gap-3 sm:grid-cols-3">
                <EField label="Estimated hours" hint="Override (optional)">
                  <EInput
                    type="number"
                    className="tabular-nums"
                    placeholder={survey.estimatedHours ? String(survey.estimatedHours) : "auto"}
                    value={overrideHours}
                    onChange={(e) => setOverrideHours(e.target.value)}
                  />
                </EField>
                <EField label="Cleaner count" hint="Override (optional)">
                  <EInput
                    type="number"
                    className="tabular-nums"
                    placeholder={
                      survey.estimatedCleanerCount
                        ? String(survey.estimatedCleanerCount)
                        : String(survey.requestedCleanerCount)
                    }
                    value={overrideCleaners}
                    onChange={(e) => setOverrideCleaners(e.target.value)}
                  />
                </EField>
                <EField label="Fixed price ($)" hint="Override (optional)">
                  <EInput
                    type="number"
                    className="tabular-nums"
                    placeholder={survey.estimatedPrice ? String(survey.estimatedPrice) : "auto"}
                    value={overridePrice}
                    onChange={(e) => setOverridePrice(e.target.value)}
                  />
                </EField>
              </div>

              <div className="flex flex-wrap items-start gap-3 border-t border-[hsl(var(--e-border))] pt-4">
                <EButton
                  variant="gold"
                  onClick={() => void handleApprove()}
                  disabled={approving || (preview ? !preview.canApprove : false)}
                >
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve &amp; Create Entities
                </EButton>
                <div className="flex min-w-[260px] flex-1 gap-2">
                  <ETextarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason (required to reject)"
                    className="min-h-[2.75rem] flex-1"
                    rows={1}
                  />
                  <EButton variant="danger" onClick={() => void handleReject()} disabled={rejecting}>
                    {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    Reject
                  </EButton>
                </div>
              </div>
            </ECardBody>
          </ECard>
        </>
      ) : null}

      {survey.status === "REJECTED" && survey.rejectionReason ? (
        <EAlert tone="danger" title="Rejected">
          {survey.rejectionReason}
        </EAlert>
      ) : null}

      {survey.status === "APPROVED" && survey.createdPropertyId ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-3">
            <p className="text-[0.8125rem] font-[600] text-[hsl(var(--e-success))]">
              Approved by {survey.adminReviewer?.name ?? "Admin"} on{" "}
              {survey.reviewedAt ? format(new Date(survey.reviewedAt), "dd MMM yyyy") : "unknown"}
            </p>
            <div className="flex flex-wrap gap-2">
              {survey.createdClientId ? (
                <EBadge tone="success" soft>
                  Client created
                </EBadge>
              ) : null}
              {survey.createdPropertyId ? (
                <Link href={`/v2/admin/properties/${survey.createdPropertyId}`}>
                  <EBadge tone="success" soft className="cursor-pointer hover:opacity-80">
                    Property created →
                  </EBadge>
                </Link>
              ) : null}
              {survey.createdIntegrationId ? (
                <EBadge tone="success" soft>
                  Integration created
                </EBadge>
              ) : null}
              {survey.createdLaundryTaskId ? (
                <EBadge tone="success" soft>
                  Laundry task created
                </EBadge>
              ) : null}
              {(survey.createdJobIds ?? []).length > 0 ? (
                <EBadge tone="success" soft>
                  {survey.createdJobIds.length} job(s) created
                </EBadge>
              ) : null}
            </div>
            <div className="space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Need the client to confirm amenities (dishwasher, oven, pool…)? Mint a shareable amenities survey
                link — answers land on the property for checklist review.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <EButton variant="outline" size="sm" onClick={() => void handleAmenitiesLink()} disabled={amenitiesLoading}>
                  {amenitiesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  {amenitiesUrl ? "Regenerate amenities link" : "Client amenities survey link"}
                </EButton>
                {amenitiesUrl ? (
                  <div className="flex min-w-[240px] flex-1 items-center gap-1">
                    <EInput readOnly value={amenitiesUrl} className="h-9 text-[0.75rem]" onFocus={(e) => e.target.select()} />
                    <EButton
                      variant="ghost"
                      size="icon"
                      aria-label="Copy amenities link"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(amenitiesUrl);
                          toast({ title: "Link copied" });
                        } catch {
                          toast({ title: "Copy failed", variant: "destructive" });
                        }
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </EButton>
                  </div>
                ) : null}
              </div>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      <EModal open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} eyebrow="Onboarding" title="Delete survey">
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            This will permanently delete {survey.surveyNumber} and all its data. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </EButton>
            <EButton variant="danger" size="sm" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
