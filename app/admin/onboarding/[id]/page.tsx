"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, CheckCircle, XCircle, Loader2, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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

  async function loadSurvey() {
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
  }

  useEffect(() => {
    loadSurvey();
  }, [params.id]);

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${params.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNotes: adminNotes || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Approval failed");
      toast({ title: "Survey approved", description: "Client, property, and jobs have been created." });
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
      if (!res.ok) throw new Error("Rejection failed");
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

  const sections = [
    {
      title: "Client",
      items: survey.isNewClient
        ? [`New: ${survey.clientData?.name ?? "Unnamed"}`, survey.clientData?.email, survey.clientData?.phone].filter(Boolean)
        : [`Existing: ${survey.existingClient?.name ?? survey.existingClientId ?? "Unknown"}`],
    },
    {
      title: "Property",
      items: [
        survey.propertyName,
        survey.propertyAddress,
        survey.propertySuburb,
        `${survey.bedrooms} bed, ${survey.bathrooms} bath`,
        survey.propertyType,
        survey.sizeSqm ? `${survey.sizeSqm} sqm` : null,
        survey.hasBalcony ? "Has balcony" : null,
        `${survey.floorCount} floor(s)`,
      ].filter(Boolean),
    },
    {
      title: "Appliances",
      items: (survey.appliances ?? []).map((a: any) => `${a.applianceType.replace(/_/g, " ")}${a.requiresClean ? " (clean)" : ""}${a.conditionNote ? `: ${a.conditionNote}` : ""}`),
    },
    {
      title: "Special Requests",
      items: (survey.specialRequests ?? []).map((r: any) => `[${r.priority}] ${r.area ? r.area + ": " : ""}${r.description}`),
    },
    {
      title: "Laundry",
      items: survey.laundryDetail
        ? [
            survey.laundryDetail.hasLaundry ? "Enabled" : "Disabled",
            survey.laundryDetail.washerType,
            survey.laundryDetail.dryerType,
            survey.laundryDetail.laundryLocation,
            survey.laundryDetail.notes,
          ].filter(Boolean)
        : ["No laundry details provided"],
    },
    {
      title: "Access Details",
      items: (survey.accessDetails ?? []).map((d: any) => `${d.detailType.replace(/_/g, " ")}: ${d.value ?? (d.photoUrl ? "Photo added" : "N/A")}`),
    },
    {
      title: "Staffing & Estimates",
      items: [
        `Requested: ${survey.requestedCleanerCount} cleaner(s)`,
        survey.estimatedHours ? `Estimated: ${survey.estimatedHours}h` : null,
        survey.estimatedCleanerCount ? `Suggested: ${survey.estimatedCleanerCount} cleaners` : null,
        survey.estimatedPrice ? `Est. price: $${survey.estimatedPrice.toFixed(2)}` : null,
      ].filter(Boolean),
    },
    {
      title: "iCal",
      items: survey.icalUrl ? [`URL: ${survey.icalUrl}`, `Provider: ${survey.icalProvider ?? "Other"}`] : ["Not provided"],
    },
    {
      title: "Job Type Answers",
      items: (survey.jobTypeAnswers ?? []).map((a: any) => `${a.jobType.replace(/_/g, " ")}: ${JSON.stringify(a.answers)}`),
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
          <Button asChild size="sm" variant="outline">
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
        <h2 className="text-2xl font-bold">{survey.surveyNumber}</h2>
        <p className="text-sm text-muted-foreground">
          {survey.propertyName ?? survey.propertyAddress ?? "No property name"}
          {survey.propertySuburb ? ` — ${survey.propertySuburb}` : ""}
          {" · "}Created {format(new Date(survey.createdAt), "dd MMM yyyy")}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {section.items.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {section.items.map((item: string | null, i: number) => (
                    item && <li key={i} className="text-muted-foreground">{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {survey.status === "PENDING_REVIEW" && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="text-base">Admin Review Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Admin notes</Label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Notes visible to cleaners on the job"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleApprove} disabled={approving}>
                {approving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />}
                Approve & Create Entities
              </Button>
              <div className="flex gap-2">
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Rejection reason"
                  className="w-[250px]"
                />
                <Button variant="destructive" onClick={handleReject} disabled={rejecting}>
                  {rejecting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
                  Reject
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {survey.status === "APPROVED" && survey.createdPropertyId && (
        <Card className="border-green-300 bg-green-50/30">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-green-800">
              Approved by {survey.adminReviewer?.name ?? "Admin"} on {survey.reviewedAt ? format(new Date(survey.reviewedAt), "dd MMM yyyy") : "unknown"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {survey.createdClientId && (
                <Badge variant="success">Client created</Badge>
              )}
              {survey.createdPropertyId && (
                <Badge variant="success">Property created</Badge>
              )}
              {survey.createdIntegrationId && (
                <Badge variant="success">Integration created</Badge>
              )}
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
