"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Loader2,
  Edit,
  Trash2,
  AlertTriangle,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "outline",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending Review",
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

export default function SurveyDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [survey, setSurvey] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [adminNotes, setAdminNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [overrideHours, setOverrideHours] = useState("");
  const [overrideCleaners, setOverrideCleaners] = useState("");
  const [overridePrice, setOverridePrice] = useState("");

  const loadSurvey = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${params.id}`);
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
  }, [params.id]);

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${params.id}/preview`);
      if (res.ok) setPreview(await res.json());
    } catch {
      /* non-blocking */
    }
  }, [params.id]);

  useEffect(() => {
    loadSurvey();
  }, [loadSurvey]);

  useEffect(() => {
    if (survey?.status === "PENDING_REVIEW") loadPreview();
  }, [survey?.status, loadPreview]);

  async function handleApprove() {
    if (preview && !preview.canApprove) {
      toast({ title: "Cannot approve", description: "Resolve the validation errors first.", variant: "destructive" });
      return;
    }
    setApproving(true);
    try {
      const adminOverrides: Record<string, number> = {};
      if (overrideHours) adminOverrides.estimatedHours = parseFloat(overrideHours);
      if (overrideCleaners) adminOverrides.cleanerCount = parseInt(overrideCleaners);
      if (overridePrice) adminOverrides.estimatedPrice = parseFloat(overridePrice);

      const res = await fetch(`/api/admin/onboarding/surveys/${params.id}/approve`, {
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
      toast({ title: "Reason required", description: "Please provide a rejection reason.", variant: "destructive" });
      return;
    }
    setRejecting(true);
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${params.id}/reject`, {
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
      const res = await fetch(`/api/admin/onboarding/surveys/${params.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete failed");
      }
      toast({ title: "Survey deleted" });
      router.push("/admin/onboarding");
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!survey) return <p className="text-sm text-muted-foreground">Survey not found.</p>;

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
          `${a.applianceType.replace(/_/g, " ")}${a.requiresClean ? " (clean)" : ""}${a.conditionNote ? `: ${a.conditionNote}` : ""}`,
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
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/onboarding")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="flex-1" />
        {survey.status === "DRAFT" && (
          <Button asChild size="sm" variant="outline" className="h-11">
            <Link href={`/admin/onboarding/new?edit=${survey.id}`}>
              <Edit className="mr-1 h-3 w-3" />
              Edit
            </Link>
          </Button>
        )}
        {(survey.status === "DRAFT" || survey.status === "REJECTED") && (
          <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
        <Badge variant={STATUS_COLORS[survey.status] as any}>{STATUS_LABELS[survey.status]}</Badge>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-foreground">{survey.surveyNumber}</h2>
        <p className="text-sm text-muted-foreground">
          {survey.propertyName ?? survey.propertyAddress ?? "No property name"}
          {survey.propertySuburb ? ` — ${survey.propertySuburb}` : ""}
          {" · "}Created {format(new Date(survey.createdAt), "dd MMM yyyy")}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => {
          const items = section.items.filter((i): i is string => typeof i === "string" && i.trim().length > 0);
          return (
            <Card key={section.title} className="rounded-xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                {items.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {items.map((item, i) => (
                      <li key={i} className="text-muted-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">None</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {survey.status === "PENDING_REVIEW" && (
        <>
          {/* Preview of what will be created */}
          {preview && (
            <Card className="rounded-xl border-sky-300/60 bg-sky-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  On approval, this will create
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {preview.preview.client.action === "create" ? "New client" : "Linked client"}: {preview.preview.client.name}
                  </Badge>
                  <Badge variant="outline">Property: {preview.preview.property.name}</Badge>
                  {preview.preview.integration && <Badge variant="outline">iCal integration</Badge>}
                  {preview.preview.laundryTask && <Badge variant="outline">Laundry task</Badge>}
                  <Badge variant="outline">{preview.preview.jobCount} job draft(s)</Badge>
                </div>
                {preview.preview.jobs.length > 0 && (
                  <p className="text-muted-foreground">Jobs: {preview.preview.jobs.join(", ")}</p>
                )}
                <p className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {preview.preview.property.hasCoordinates
                    ? "Property already geocoded."
                    : preview.preview.property.willGeocode
                      ? "Address will be geocoded on approval."
                      : "No address to geocode — maps/GPS may be limited."}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Validation errors */}
          {preview && preview.errors.length > 0 && (
            <Card className="rounded-xl border-destructive/50 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Resolve before approving
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
                  {preview.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Review actions */}
          <Card className="rounded-xl border-amber-300">
            <CardHeader>
              <CardTitle className="text-base">Admin Review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Admin notes (visible to cleaners on the job)</Label>
                <Textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Notes visible to cleaners on the job"
                />
              </div>

              <div>
                <Label className="text-sm">Overrides (optional)</Label>
                <div className="mt-1 grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Estimated hours</Label>
                    <Input
                      type="number"
                      className="h-11 tabular-nums"
                      placeholder={survey.estimatedHours ? String(survey.estimatedHours) : "auto"}
                      value={overrideHours}
                      onChange={(e) => setOverrideHours(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Cleaner count</Label>
                    <Input
                      type="number"
                      className="h-11 tabular-nums"
                      placeholder={
                        survey.estimatedCleanerCount
                          ? String(survey.estimatedCleanerCount)
                          : String(survey.requestedCleanerCount)
                      }
                      value={overrideCleaners}
                      onChange={(e) => setOverrideCleaners(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Fixed price ($)</Label>
                    <Input
                      type="number"
                      className="h-11 tabular-nums"
                      placeholder={survey.estimatedPrice ? String(survey.estimatedPrice) : "auto"}
                      value={overridePrice}
                      onChange={(e) => setOverridePrice(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-start gap-3">
                <Button
                  onClick={handleApprove}
                  disabled={approving || (preview ? !preview.canApprove : false)}
                  className="h-11"
                >
                  {approving ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-1 h-4 w-4" />
                  )}
                  Approve &amp; Create Entities
                </Button>
                <div className="flex flex-1 gap-2">
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason (required to reject)"
                    className="min-w-[220px] flex-1"
                  />
                  <Button variant="destructive" onClick={handleReject} disabled={rejecting} className="h-11">
                    {rejecting ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="mr-1 h-4 w-4" />
                    )}
                    Reject
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {survey.status === "REJECTED" && survey.rejectionReason && (
        <Card className="rounded-xl border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-destructive">Rejected</p>
            <p className="mt-1 text-muted-foreground">{survey.rejectionReason}</p>
          </CardContent>
        </Card>
      )}

      {survey.status === "APPROVED" && survey.createdPropertyId && (
        <Card className="rounded-xl border-green-300 bg-green-50/30">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-green-800">
              Approved by {survey.adminReviewer?.name ?? "Admin"} on{" "}
              {survey.reviewedAt ? format(new Date(survey.reviewedAt), "dd MMM yyyy") : "unknown"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {survey.createdClientId && <Badge variant="success">Client created</Badge>}
              {survey.createdPropertyId && (
                <Link href={`/admin/properties/${survey.createdPropertyId}`}>
                  <Badge variant="success" className="cursor-pointer hover:opacity-80">
                    Property created →
                  </Badge>
                </Link>
              )}
              {survey.createdIntegrationId && <Badge variant="success">Integration created</Badge>}
              {survey.createdLaundryTaskId && <Badge variant="success">Laundry task created</Badge>}
              {(survey.createdJobIds ?? []).length > 0 && (
                <Badge variant="success">{survey.createdJobIds.length} job(s) created</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete survey</DialogTitle>
            <DialogDescription>
              This will permanently delete {survey.surveyNumber} and all its data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
