"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, UserPlus, Star, FileText, Send } from "lucide-react";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { MediaGallery } from "@/components/shared/media-gallery";
import { MultiSelectDropdown } from "@/components/shared/multi-select-dropdown";
import { JobAttachmentsInput } from "@/components/admin/job-attachments-input";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { parseJobInternalNotes, summarizeJobRules, type JobTimingPreset } from "@/lib/jobs/meta";
import { downloadFromApi } from "@/lib/client/download";

const STATUS_COLORS: Record<string, any> = {
  UNASSIGNED: "warning",
  ASSIGNED: "secondary",
  IN_PROGRESS: "default",
  SUBMITTED: "secondary",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "outline",
};
const COMPLETED_STATUSES = new Set(["COMPLETED", "INVOICED"]);

function toLocalDateInput(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function valuesEqual(left: unknown, right: unknown) {
  if (typeof left === "boolean") return left === (right === true || right === "true");
  if (typeof left === "number") return left === Number(right);
  if (typeof right === "boolean") return (left === true || left === "true") === right;
  if (typeof right === "number") return Number(left) === right;
  return String(left ?? "") === String(right ?? "");
}

function isConditionMet(
  conditional: { fieldId?: string; propertyField?: string; value?: unknown } | undefined,
  answers: Record<string, unknown>,
  property: Record<string, unknown>
) {
  if (!conditional || typeof conditional !== "object") return true;

  if (conditional.propertyField) {
    return valuesEqual(property[conditional.propertyField], conditional.value);
  }

  if (conditional.fieldId) {
    return valuesEqual(answers[conditional.fieldId], conditional.value);
  }

  return true;
}

function uploadCount(uploads: Record<string, unknown>, media: Array<{ fieldId: string }>, fieldId: string) {
  const raw = uploads[fieldId];
  if (typeof raw === "string") return raw.trim() ? 1 : 0;
  if (Array.isArray(raw)) {
    return raw.filter((item) => typeof item === "string" && item.trim()).length;
  }
  return media.filter((item) => item.fieldId === fieldId).length;
}

function checkboxMark(checked: boolean) {
  return checked ? "\u2611" : "\u2610";
}

function renderFieldValue(field: any, submission: any) {
  const answers = submission?.data && typeof submission.data === "object" ? submission.data : {};
  const uploads = answers?.uploads && typeof answers.uploads === "object" ? answers.uploads : {};

  if (field.type === "upload") {
    const count = uploadCount(uploads, submission?.media ?? [], String(field.id));
    return count > 0 ? `${count} file(s) uploaded` : "Not uploaded";
  }

  if (field.type === "inventory") {
    const txs = (submission?.stockTxs ?? []).filter((tx: any) => tx.quantity < 0);
    if (txs.length === 0) return "No inventory used";
    return txs
      .map((tx: any) => `${tx.propertyStock?.item?.name ?? tx.propertyStock?.itemId ?? "Item"}: ${Math.abs(tx.quantity)}`)
      .join(", ");
  }

  const value = answers[field.id];
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<any>(null);
  const [cleaners, setCleaners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  const [qaScore, setQaScore] = useState("90");
  const [qaNotes, setQaNotes] = useState("");
  const [sharing, setSharing] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingJob, setDeletingJob] = useState(false);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [continuationRows, setContinuationRows] = useState<any[]>([]);
  const [continuationLoading, setContinuationLoading] = useState(false);
  const [continuationDialog, setContinuationDialog] = useState<{ request: any; decision: "APPROVE" | "REJECT" } | null>(null);
  const [continuationSubmitting, setContinuationSubmitting] = useState(false);
  const [continuationForm, setContinuationForm] = useState({
    decisionNote: "",
    newScheduledDate: "",
    newCleanerId: "",
    previousCleanerHours: "",
    newCleanerHours: "",
    newCleanerPayRate: "",
    transportAllowance: "",
  });
  const [templateName, setTemplateName] = useState("");
  const [editForm, setEditForm] = useState({
    status: "UNASSIGNED",
    scheduledDate: "",
    startTime: "",
    dueTime: "",
    endTime: "",
    estimatedHours: "",
    notes: "",
    internalNotes: "",
    isDraft: false,
    tagsText: "",
    attachments: [] as any[],
    transportAllowances: {} as Record<string, string>,
    earlyCheckin: { enabled: false, preset: "none" as JobTimingPreset, time: "" },
    lateCheckout: { enabled: false, preset: "none" as JobTimingPreset, time: "" },
  });

  function load() {
    fetch(`/api/admin/jobs/${params.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setJob(j);
        if (!j?.error) {
          const meta = j.jobMeta ?? parseJobInternalNotes(j.internalNotes);
          const scheduledDate = j?.scheduledDate ? toLocalDateInput(j.scheduledDate) : "";
          const assignedCleanerIds = Array.isArray(j?.assignments)
            ? j.assignments
                .map((assignment: any) => assignment?.userId ?? assignment?.user?.id)
                .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
            : [];
          setEditForm({
            status: j.status ?? "UNASSIGNED",
            scheduledDate,
            startTime: j.startTime ?? "",
            dueTime: j.dueTime ?? "",
            endTime: j.endTime ?? "",
            estimatedHours: j.estimatedHours != null ? String(j.estimatedHours) : "",
            notes: j.notes ?? "",
            internalNotes: meta.internalNoteText ?? "",
            isDraft: meta.isDraft ?? false,
            tagsText: Array.isArray(meta.tags) ? meta.tags.join(", ") : "",
            attachments: Array.isArray(meta.attachments) ? meta.attachments : [],
            transportAllowances: Object.fromEntries(
              Object.entries(meta.transportAllowances ?? {}).map(([userId, amount]) => [userId, String(amount)])
            ),
            earlyCheckin: {
              enabled: meta.earlyCheckin?.enabled === true,
              preset: meta.earlyCheckin?.preset ?? "none",
              time:
                meta.earlyCheckin?.preset === "custom"
                  ? meta.earlyCheckin?.time ?? ""
                  : meta.earlyCheckin?.preset && meta.earlyCheckin?.preset !== "none"
                    ? meta.earlyCheckin.preset
                    : "",
            },
            lateCheckout: {
              enabled: meta.lateCheckout?.enabled === true,
              preset: meta.lateCheckout?.preset ?? "none",
              time:
                meta.lateCheckout?.preset === "custom"
                  ? meta.lateCheckout?.time ?? ""
                  : meta.lateCheckout?.preset && meta.lateCheckout?.preset !== "none"
                    ? meta.lateCheckout.preset
                    : "",
            },
          });
          setSelectedCleaners(assignedCleanerIds);
          setTemplateName(`${j.jobType?.replace(/_/g, " ")} template`);
        }
        setLoading(false);
      });
  }

  async function loadTimeline() {
    setTimelineLoading(true);
    const res = await fetch(`/api/admin/jobs/${params.id}/timeline`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setTimeline(Array.isArray(body.timeline) ? body.timeline : []);
    }
    setTimelineLoading(false);
  }

  async function loadContinuations() {
    setContinuationLoading(true);
    const res = await fetch(`/api/admin/job-continuations?jobId=${params.id}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setContinuationRows(Array.isArray(body) ? body : []);
    } else {
      toast({
        title: "Could not load continuation requests",
        description: body.error ?? "Please retry.",
        variant: "destructive",
      });
    }
    setContinuationLoading(false);
  }

  useEffect(() => {
    load();
    loadTimeline();
    loadContinuations();
    fetch(`/api/admin/users?role=CLEANER&includeInactive=1&t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).then(setCleaners).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function openAssignDialog() {
    const assignedCleanerIds = Array.isArray(job?.assignments)
      ? job.assignments
          .map((assignment: any) => assignment?.userId ?? assignment?.user?.id)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : [];
    setSelectedCleaners(assignedCleanerIds);
    setAssignOpen(true);
  }

  async function assign() {
    const needsCompletedResetConfirm =
      selectedCleaners.length === 0 && COMPLETED_STATUSES.has(String(job?.status ?? ""));
    if (
      needsCompletedResetConfirm &&
      !window.confirm("This job is completed/invoiced. Move it back to Unassigned and remove all assignees?")
    ) {
      return;
    }

    const res = await fetch(`/api/admin/jobs/${params.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds: selectedCleaners,
        primaryUserId: selectedCleaners[0],
        confirmCompletedReset: needsCompletedResetConfirm || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Assignment failed",
        description: err.message ?? err.error ?? "Could not assign cleaners.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: selectedCleaners.length > 0 ? "Assignees updated" : "All assignees removed" });
    setAssignOpen(false);
    load();
  }

  async function autoAssignTop(limit = 2) {
    setAutoAssigning(true);
    try {
      const suggestRes = await fetch(`/api/admin/dispatch/auto-assign/${params.id}/suggest`);
      const suggestBody = await suggestRes.json().catch(() => ({}));
      if (!suggestRes.ok) {
        throw new Error(suggestBody.error ?? "Could not generate cleaner suggestions.");
      }
      const suggestions = Array.isArray(suggestBody?.suggestions) ? suggestBody.suggestions : [];
      const cleanerIds = suggestions
        .slice(0, limit)
        .map((row: any) => row?.cleanerId)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
      if (cleanerIds.length === 0) {
        throw new Error("No eligible cleaner suggestions found.");
      }

      const applyRes = await fetch(`/api/admin/dispatch/auto-assign/${params.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanerIds }),
      });
      const applyBody = await applyRes.json().catch(() => ({}));
      if (!applyRes.ok) {
        throw new Error(applyBody.error ?? "Could not apply auto assignment.");
      }

      setSelectedCleaners(cleanerIds);
      toast({ title: "Auto-assignment applied", description: `Assigned top ${cleanerIds.length} cleaner(s).` });
      setAssignOpen(false);
      load();
    } catch (err: any) {
      toast({
        title: "Auto-assign failed",
        description: err?.message ?? "Could not auto-assign cleaners.",
        variant: "destructive",
      });
    } finally {
      setAutoAssigning(false);
    }
  }

  async function submitQa() {
    const res = await fetch(`/api/admin/jobs/${params.id}/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: parseFloat(qaScore), notes: qaNotes }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: "QA failed", description: err.error ?? "Could not submit QA review.", variant: "destructive" });
      return;
    }
    toast({ title: "QA review submitted" });
    setQaOpen(false);
    load();
  }

  async function shareReport() {
    const defaultEmail = job?.property?.client?.email ?? "";
    const to = window.prompt("Share report to email:", defaultEmail) ?? "";
    if (!to.trim()) return;

    setSharing(true);
    const res = await fetch(`/api/admin/reports/${params.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: to.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setSharing(false);

    if (!res.ok) {
      toast({ title: "Share failed", description: body.error ?? "Could not email report.", variant: "destructive" });
      return;
    }

    toast({ title: "Report shared", description: `Sent to ${to.trim()}` });
    load();
  }

  async function downloadReport() {
    const refreshRes = await fetch(`/api/admin/reports/${params.id}/generate`, { method: "POST" });
    if (!refreshRes.ok) {
      const body = await refreshRes.json().catch(() => ({}));
      toast({ title: "Report refresh failed", description: body.error ?? "Could not refresh report.", variant: "destructive" });
      return;
    }

    try {
      await downloadFromApi(`/api/reports/${params.id}/download`, `job-report-${params.id}.pdf`);
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error?.message ?? "Could not download report.",
        variant: "destructive",
      });
    }
  }

  async function saveJobChanges() {
    if (!editForm.scheduledDate) {
      toast({ title: "Scheduled date is required.", variant: "destructive" });
      return;
    }

    setSavingJob(true);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(editForm.scheduledDate)) {
        throw new Error("Invalid schedule date.");
      }

      const payload = {
        status: editForm.status,
        scheduledDate: `${editForm.scheduledDate}T00:00:00.000Z`,
        startTime: editForm.startTime || undefined,
        dueTime: editForm.dueTime || undefined,
        endTime: editForm.endTime || undefined,
        estimatedHours: editForm.estimatedHours ? Number(editForm.estimatedHours) : undefined,
        notes: editForm.notes || undefined,
        internalNotes: editForm.internalNotes || undefined,
        isDraft: editForm.isDraft,
        tags: editForm.tagsText.split(",").map((value) => value.trim()).filter(Boolean),
        attachments: editForm.attachments,
        transportAllowances: Object.entries(editForm.transportAllowances).reduce<Record<string, number>>(
          (acc, [userId, amountRaw]) => {
            const amount = Number(amountRaw);
            if (typeof userId === "string" && userId.trim().length > 0 && Number.isFinite(amount) && amount > 0) {
              acc[userId.trim()] = Number(amount.toFixed(2));
            }
            return acc;
          },
          {}
        ),
        earlyCheckin: editForm.earlyCheckin.enabled ? { enabled: true, preset: editForm.earlyCheckin.preset, time: editForm.earlyCheckin.preset === "custom" ? editForm.earlyCheckin.time || undefined : undefined } : { enabled: false, preset: "none" },
        lateCheckout: editForm.lateCheckout.enabled ? { enabled: true, preset: editForm.lateCheckout.preset, time: editForm.lateCheckout.preset === "custom" ? editForm.lateCheckout.time || undefined : undefined } : { enabled: false, preset: "none" },
        confirmCompletedReset: undefined as boolean | undefined,
      };
      const needsCompletedResetConfirm =
        editForm.status === "UNASSIGNED" && COMPLETED_STATUSES.has(String(job?.status ?? ""));
      if (
        needsCompletedResetConfirm &&
        !window.confirm("This job is completed/invoiced. Move it back to Unassigned?")
      ) {
        setSavingJob(false);
        return;
      }
      if (needsCompletedResetConfirm) {
        payload.confirmCompletedReset = true;
      }

      const res = await fetch(`/api/admin/jobs/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? "Could not update job.");
      }
      toast({ title: "Job updated" });
      load();
      loadContinuations();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message ?? "Could not update job.", variant: "destructive" });
    } finally {
      setSavingJob(false);
    }
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) {
      toast({ title: "Template name is required.", variant: "destructive" });
      return;
    }

    setSavingTemplate(true);
    try {
      const res = await fetch("/api/admin/job-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          jobType: job.jobType,
          startTime: editForm.startTime || undefined,
          dueTime: editForm.dueTime || undefined,
          endTime: editForm.endTime || undefined,
          estimatedHours: editForm.estimatedHours ? Number(editForm.estimatedHours) : undefined,
          notes: editForm.notes || undefined,
          internalNotes: editForm.internalNotes || undefined,
          isDraft: editForm.isDraft,
          tags: editForm.tagsText.split(",").map((value) => value.trim()).filter(Boolean),
          attachments: editForm.attachments,
          earlyCheckin: editForm.earlyCheckin.enabled ? { enabled: true, preset: editForm.earlyCheckin.preset, time: editForm.earlyCheckin.preset === "custom" ? editForm.earlyCheckin.time || undefined : undefined } : { enabled: false, preset: "none" },
          lateCheckout: editForm.lateCheckout.enabled ? { enabled: true, preset: editForm.lateCheckout.preset, time: editForm.lateCheckout.preset === "custom" ? editForm.lateCheckout.time || undefined : undefined } : { enabled: false, preset: "none" },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not save template.");
      }
      toast({ title: "Template saved" });
    } catch (err: any) {
      toast({ title: "Template save failed", description: err.message ?? "Could not save template.", variant: "destructive" });
    } finally {
      setSavingTemplate(false);
    }
  }

  function openContinuationDialog(request: any, decision: "APPROVE" | "REJECT") {
    const currentDate = toLocalDateInput(job?.scheduledDate ?? new Date());
    setContinuationForm({
      decisionNote: "",
      newScheduledDate: request?.preferredDate ?? currentDate,
      newCleanerId: request?.approvalPlan?.newCleanerId ?? selectedCleaners[0] ?? "",
      previousCleanerHours:
        request?.snapshot?.estimatedHours != null ? String(request.snapshot.estimatedHours) : editForm.estimatedHours,
      newCleanerHours:
        request?.estimatedRemainingHours != null ? String(request.estimatedRemainingHours) : editForm.estimatedHours,
      newCleanerPayRate: "",
      transportAllowance: "",
    });
    setContinuationDialog({ request, decision });
  }

  async function submitContinuationDecision() {
    if (!continuationDialog) return;
    if (continuationDialog.decision === "APPROVE" && !continuationForm.newScheduledDate) {
      toast({ title: "New schedule date is required.", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      decision: continuationDialog.decision,
      decisionNote: continuationForm.decisionNote || undefined,
    };
    if (continuationDialog.decision === "APPROVE") {
      payload.newScheduledDate = continuationForm.newScheduledDate || undefined;
      payload.newCleanerId = continuationForm.newCleanerId || undefined;
      payload.previousCleanerHours = continuationForm.previousCleanerHours
        ? Number(continuationForm.previousCleanerHours)
        : undefined;
      payload.newCleanerHours = continuationForm.newCleanerHours ? Number(continuationForm.newCleanerHours) : undefined;
      payload.newCleanerPayRate = continuationForm.newCleanerPayRate
        ? Number(continuationForm.newCleanerPayRate)
        : undefined;
      payload.transportAllowance = continuationForm.transportAllowance
        ? Number(continuationForm.transportAllowance)
        : undefined;
    }

    setContinuationSubmitting(true);
    const res = await fetch(`/api/admin/job-continuations/${continuationDialog.request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setContinuationSubmitting(false);
    if (!res.ok) {
      toast({
        title: "Decision failed",
        description: body.error ?? "Could not update continuation request.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: continuationDialog.decision === "APPROVE" ? "Continuation approved" : "Continuation rejected",
    });
    setContinuationDialog(null);
    await loadContinuations();
    load();
  }

  async function deleteJob() {
    setDeletingJob(true);
    try {
      const res = await fetch(`/api/admin/jobs/${params.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not delete job.");
      }
      toast({ title: "Job deleted" });
      setDeleteOpen(false);
      router.push("/admin/jobs");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message ?? "Could not delete job.", variant: "destructive" });
    } finally {
      setDeletingJob(false);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!job || job.error) return <div className="p-8 text-destructive">Job not found.</div>;
  const jobMeta = job.jobMeta ?? parseJobInternalNotes(job.internalNotes);
  const cleanerLookup = new Map(
    cleaners.map((cleaner: any) => [cleaner.id, cleaner.name ?? cleaner.email ?? cleaner.id])
  );
  const transportAllowanceCleanerIds = Array.from(
    new Set([...selectedCleaners, ...Object.keys(editForm.transportAllowances ?? {})])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/jobs">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{job.property.name}</h2>
          <p className="text-sm text-muted-foreground">
            {job.property.address}, {job.property.suburb} - {job.jobType.replace(/_/g, " ")} - {" "}
            {format(new Date(job.scheduledDate), "EEEE dd MMMM yyyy")}
            {job.startTime && ` - ${job.startTime}${job.dueTime ? ` to ${job.dueTime}` : ""}`}
          </p>
        </div>
        {jobMeta.isDraft ? <Badge variant="outline">Draft</Badge> : null}
        <Badge variant={STATUS_COLORS[job.status]}>{job.status.replace(/_/g, " ")}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={openAssignDialog}>
          <UserPlus className="mr-2 h-4 w-4" /> Assign Cleaners
        </Button>
        {job.status === "SUBMITTED" && (
          <Button size="sm" variant="outline" onClick={() => setQaOpen(true)}>
            <Star className="mr-2 h-4 w-4" /> QA Review
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={downloadReport}>
          <FileText className="mr-2 h-4 w-4" /> Download Report
        </Button>
        <Button size="sm" variant="outline" onClick={shareReport} disabled={sharing}>
          <Send className="mr-2 h-4 w-4" /> {sharing ? "Sharing..." : "Share To Client"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
          Delete Job
        </Button>
        {job.report?.sentToClient && <Badge variant="success">Shared with client</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Edit Job</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <select
                className="h-10 w-full rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
                value={editForm.status}
                onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value }))}
              >
                {Object.keys(STATUS_COLORS).map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Scheduled date</Label>
              <Input
                type="date"
                value={editForm.scheduledDate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, scheduledDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Fixed / allocated pay hours</Label>
              <Input
                type="number"
                step="0.25"
                min="0"
                value={editForm.estimatedHours}
                onChange={(e) => setEditForm((prev) => ({ ...prev, estimatedHours: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to pay from cleaner clocked timer.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Start time</Label>
              <Input
                type="time"
                value={editForm.startTime}
                onChange={(e) => setEditForm((prev) => ({ ...prev, startTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Due time</Label>
              <Input
                type="time"
                value={editForm.dueTime}
                onChange={(e) => setEditForm((prev) => ({ ...prev, dueTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>End time</Label>
              <Input
                type="time"
                value={editForm.endTime}
                onChange={(e) => setEditForm((prev) => ({ ...prev, endTime: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Tags</Label>
            <Input
              value={editForm.tagsText}
              onChange={(e) => setEditForm((prev) => ({ ...prev, tagsText: e.target.value }))}
              placeholder="priority, VIP guest"
            />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editForm.isDraft}
                onChange={(e) => setEditForm((prev) => ({ ...prev, isDraft: e.target.checked }))}
              />
              Draft
            </Label>
          </div>
          <div className="space-y-1">
            <Label>Job notes</Label>
            <Textarea value={editForm.notes} onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Internal notes</Label>
            <Textarea
              value={editForm.internalNotes}
              onChange={(e) => setEditForm((prev) => ({ ...prev, internalNotes: e.target.value }))}
            />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Transport allowance (optional)</Label>
              <p className="text-xs text-muted-foreground">Shown only when amount is set</p>
            </div>
            {transportAllowanceCleanerIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">Assign cleaners first to set allowance per cleaner.</p>
            ) : (
              <div className="space-y-2">
                {transportAllowanceCleanerIds.map((cleanerId) => (
                  <div key={cleanerId} className="grid grid-cols-[1fr_140px_auto] items-center gap-2">
                    <p className="truncate text-sm">{cleanerLookup.get(cleanerId) ?? cleanerId}</p>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.transportAllowances[cleanerId] ?? ""}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          transportAllowances: {
                            ...prev.transportAllowances,
                            [cleanerId]: e.target.value,
                          },
                        }))
                      }
                      placeholder="0.00"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditForm((prev) => {
                          const next = { ...prev.transportAllowances };
                          delete next[cleanerId];
                          return { ...prev, transportAllowances: next };
                        })
                      }
                    >
                      Clear
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Early check-in</Label>
              <Select
                value={editForm.earlyCheckin.preset}
                onValueChange={(value) =>
                  setEditForm((prev) => {
                    const next = {
                      ...prev,
                      earlyCheckin: {
                        enabled: value !== "none",
                        preset: value as JobTimingPreset,
                        time: value === "custom" ? prev.earlyCheckin.time : value !== "none" ? value : "",
                      },
                    };
                    const nextDue = value === "custom" ? prev.earlyCheckin.time : value !== "none" ? value : "";
                    if (nextDue) {
                      next.dueTime = nextDue;
                    }
                    if (next.startTime && next.dueTime && next.dueTime < next.startTime) {
                      next.dueTime = next.startTime;
                    }
                    return next;
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="11:00">Before 11:00 AM</SelectItem>
                  <SelectItem value="12:30">Before 12:30 PM</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {editForm.earlyCheckin.preset === "custom" ? (
                <Input
                  type="time"
                  value={editForm.earlyCheckin.time}
                  onChange={(e) =>
                    setEditForm((prev) => {
                      const next = {
                        ...prev,
                        earlyCheckin: { ...prev.earlyCheckin, enabled: true, time: e.target.value },
                      };
                      if (e.target.value) {
                        next.dueTime = e.target.value;
                      }
                      if (next.startTime && next.dueTime && next.dueTime < next.startTime) {
                        next.dueTime = next.startTime;
                      }
                      return next;
                    })
                  }
                />
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Late checkout</Label>
              <Select
                value={editForm.lateCheckout.preset}
                onValueChange={(value) =>
                  setEditForm((prev) => {
                    const next = {
                      ...prev,
                      lateCheckout: {
                        enabled: value !== "none",
                        preset: value as JobTimingPreset,
                        time: value === "custom" ? prev.lateCheckout.time : value !== "none" ? value : "",
                      },
                    };
                    const nextStart = value === "custom" ? prev.lateCheckout.time : value !== "none" ? value : "";
                    if (nextStart) {
                      next.startTime = nextStart;
                    }
                    if (next.startTime && next.dueTime && next.dueTime < next.startTime) {
                      next.dueTime = next.startTime;
                    }
                    return next;
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="12:30">Start after 12:30 PM</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {editForm.lateCheckout.preset === "custom" ? (
                <Input
                  type="time"
                  value={editForm.lateCheckout.time}
                  onChange={(e) =>
                    setEditForm((prev) => {
                      const next = {
                        ...prev,
                        lateCheckout: { ...prev.lateCheckout, enabled: true, time: e.target.value },
                      };
                      if (e.target.value) {
                        next.startTime = e.target.value;
                      }
                      if (next.startTime && next.dueTime && next.dueTime < next.startTime) {
                        next.dueTime = next.startTime;
                      }
                      return next;
                    })
                  }
                />
              ) : null}
            </div>
          </div>
          <JobAttachmentsInput
            value={editForm.attachments}
            onChange={(attachments) => setEditForm((prev) => ({ ...prev, attachments }))}
          />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={saveJobChanges} disabled={savingJob}>
              {savingJob ? "Saving..." : "Save Changes"}
            </Button>
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
              className="max-w-xs"
            />
            <Button size="sm" variant="outline" onClick={saveAsTemplate} disabled={savingTemplate}>
              {savingTemplate ? "Saving..." : "Save as Template"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="submission">Submission</TabsTrigger>
          <TabsTrigger value="laundry">Laundry</TabsTrigger>
          <TabsTrigger value="timelogs">Time Logs</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Continuation Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {continuationLoading ? (
                <p className="text-sm text-muted-foreground">Loading requests...</p>
              ) : continuationRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No continuation requests for this job.</p>
              ) : (
                continuationRows.map((row) => (
                  <div key={row.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {row.requestedBy?.name ?? row.requestedBy?.email ?? row.requestedByUserId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Requested {format(new Date(row.requestedAt), "dd MMM yyyy HH:mm")}
                        </p>
                      </div>
                      <Badge variant={row.status === "PENDING" ? "warning" : row.status === "APPROVED" ? "success" : "outline"}>
                        {row.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{row.reason}</p>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <p>Preferred date: {row.preferredDate || "-"}</p>
                      <p>Remaining hours: {row.estimatedRemainingHours ?? "-"}</p>
                      <p>
                        Snapshot cleaners: {Array.isArray(row.snapshot?.loggedMinutesByCleaner) ? row.snapshot.loggedMinutesByCleaner.length : 0}
                      </p>
                    </div>
                    {row.status === "APPROVED" && row.continuationJobId ? (
                      <p className="mt-2 text-xs text-emerald-600">Continuation job: {row.continuationJobId}</p>
                    ) : null}
                    {row.status === "PENDING" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => openContinuationDialog(row, "APPROVE")}>
                          Approve & schedule continuation
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openContinuationDialog(row, "REJECT")}>
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Planning Flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summarizeJobRules(jobMeta).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {summarizeJobRules(jobMeta).map((item) => (
                    <Badge key={item} variant="outline">{item}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No draft or turnaround flags set.</p>
              )}
              {(jobMeta.tags?.length ?? 0) > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {jobMeta.tags?.map((tag: string) => (
                    <span key={tag} className="rounded-full border px-2 py-1 text-xs">{tag}</span>
                  ))}
                </div>
              ) : null}
              <MediaGallery
                items={((jobMeta.attachments ?? []) as any[]).map((item) => ({
                  id: item.key,
                  url: item.url,
                  label: item.name,
                }))}
                emptyText="No reference files"
                title="Job Reference Files"
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Assigned Cleaners</CardTitle>
              </CardHeader>
              <CardContent>
                {job.assignments.length > 0 ? (
                  <ul className="space-y-1">
                    {job.assignments.map((a: any) => (
                      <li key={a.id} className="flex items-center gap-2 text-sm">
                        {a.isPrimary && (
                          <Badge variant="outline" className="text-xs">
                            Primary
                          </Badge>
                        )}
                        {a.user.name} - {a.user.email}
                        {Number(jobMeta.transportAllowances?.[a.userId] ?? 0) > 0 ? (
                          <Badge variant="secondary">
                            Transport ${Number(jobMeta.transportAllowances[a.userId]).toFixed(2)}
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No cleaners assigned yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">QA</CardTitle>
              </CardHeader>
              <CardContent>
                {job.qaReviews.length > 0 ? (
                  <div>
                    <p className="text-2xl font-bold">{job.qaReviews[0].score.toFixed(0)}%</p>
                    <Badge variant={job.qaReviews[0].passed ? "success" : "destructive"}>
                      {job.qaReviews[0].passed ? "Passed" : "Failed"}
                    </Badge>
                    {job.qaReviews[0].notes && <p className="mt-2 text-xs text-muted-foreground">{job.qaReviews[0].notes}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No QA review yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {job.notes && (
            <Card>
              <CardContent className="pt-4">
                <p className="mb-1 text-xs text-muted-foreground">Job Notes</p>
                <p className="text-sm">{job.notes}</p>
              </CardContent>
            </Card>
          )}

          {job.property.accessInfo && (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="space-y-1 pt-4 text-sm">
                {Object.entries(job.property.accessInfo as Record<string, string>).map(([k, v]) => (
                  <p key={k}>
                    <strong className="capitalize">{k}:</strong> {v}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="submission">
          {job.formSubmissions.length > 0 ? (
            <div className="space-y-4">
              {job.formSubmissions.map((sub: any) => {
                const answers = sub?.data && typeof sub.data === "object" ? sub.data : {};
                const sections = Array.isArray(sub?.template?.schema?.sections) ? sub.template.schema.sections : [];
                const property = (job?.property ?? {}) as Record<string, unknown>;

                return (
                  <Card key={sub.id}>
                    <CardHeader>
                      <CardTitle className="text-sm">
                        {sub.template?.name} - by {sub.submittedBy?.name} - {format(new Date(sub.createdAt), "dd MMM HH:mm")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {sub.laundryReady !== null && (
                          <Badge variant={sub.laundryReady ? "default" : "secondary"}>
                            Laundry {sub.laundryReady ? "Ready" : "Not ready"}
                          </Badge>
                        )}
                        {sub.bagLocation ? <span className="text-xs text-muted-foreground">Bag location: {sub.bagLocation}</span> : null}
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Submission Media (batch preview)</p>
                        <MediaGallery
                          items={(sub.media ?? []).map((m: any) => ({
                            id: m.id,
                            url: m.url,
                            label: m.label ?? m.fieldId,
                            mediaType: m.mediaType,
                          }))}
                          emptyText="No uploaded media"
                          title="Submission Media"
                        />
                      </div>

                      <div className="space-y-4">
                        {sections
                          .filter((section: any) => isConditionMet(section?.conditional, answers, property))
                          .map((section: any) => {
                            const fields = (Array.isArray(section?.fields) ? section.fields : []).filter((field: any) =>
                              isConditionMet(field?.conditional, answers, property)
                            );
                            if (fields.length === 0) return null;

                            return (
                              <div key={section.id} className="rounded-md border">
                                <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">{section.label}</div>
                                <div className="divide-y">
                                  {fields.map((field: any) => {
                                    const answers = sub?.data && typeof sub.data === "object" ? sub.data : {};
                                    const isCheckbox = field.type === "checkbox";
                                    const checked = isCheckbox ? answers[field.id] === true : false;
                                    const label = isCheckbox
                                      ? `${checkboxMark(checked)} ${String(field.label ?? field.id ?? "Checklist item")}`
                                      : String(field.label ?? field.id ?? "Checklist item");
                                    const value = renderFieldValue(field, sub);
                                    const mediaForField = (sub.media ?? []).filter((m: any) => m.fieldId === field.id);
                                    return (
                                      <div key={field.id} className="px-3 py-2">
                                        <div className="flex items-start justify-between gap-4">
                                          <p className="text-sm">{label}</p>
                                          <p className="text-sm font-medium text-right">{isCheckbox ? "" : value}</p>
                                        </div>
                                        {mediaForField.length > 0 && (
                                          <div className="mt-2">
                                            <MediaGallery
                                              items={mediaForField.map((m: any) => ({
                                                id: m.id,
                                                url: m.url,
                                                label: m.label ?? m.fieldId,
                                                mediaType: m.mediaType,
                                              }))}
                                              emptyText="No media for this field"
                                              title={field.label ?? "Field Media"}
                                              className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
                                            />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">No form submission yet.</p>
          )}
        </TabsContent>

        <TabsContent value="laundry">
          {job.laundryTask ? (
            <Card>
              <CardContent className="space-y-2 pt-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge>{job.laundryTask.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pickup</span>
                  <span>{format(new Date(job.laundryTask.pickupDate), "EEE dd MMM yyyy")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Drop-off</span>
                  <span>{format(new Date(job.laundryTask.dropoffDate), "EEE dd MMM yyyy")}</span>
                </div>
                {job.laundryTask.flagReason && (
                  <div className="mt-3 rounded-lg bg-destructive/10 p-3">
                    <p className="font-medium text-destructive">{job.laundryTask.flagReason.replace(/_/g, " ")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{job.laundryTask.flagNotes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">No laundry task generated yet. Run the laundry planner.</p>
          )}
        </TabsContent>

        <TabsContent value="timelogs">
          {job.timeLogs.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-xs text-muted-foreground">
                      <th className="p-4 text-left">Cleaner</th>
                      <th className="p-4 text-left">Start</th>
                      <th className="p-4 text-left">Stop</th>
                      <th className="p-4 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {job.timeLogs.map((log: any) => (
                      <tr key={log.id}>
                        <td className="p-4">{log.user.name}</td>
                        <td className="p-4">{format(new Date(log.startedAt), "HH:mm")}</td>
                        <td className="p-4">{log.stoppedAt ? format(new Date(log.stoppedAt), "HH:mm") : "-"}</td>
                        <td className="p-4 text-right">{log.durationM ? `${log.durationM}m` : "Active"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">No time logs recorded.</p>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Activity Timeline</CardTitle>
              <Button variant="outline" size="sm" onClick={loadTimeline}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {timelineLoading ? (
                <p className="text-sm text-muted-foreground">Loading timeline...</p>
              ) : timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline events found for this job.</p>
              ) : (
                <div className="space-y-2">
                  {timeline.map((event) => (
                    <div key={event.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{event.title}</p>
                        <Badge variant="outline">{event.type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(event.at), "dd MMM yyyy HH:mm")}
                        {event.actorName ? ` • ${event.actorName}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{event.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Cleaners</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <MultiSelectDropdown
              options={cleaners.map((c: any) => ({
                id: c.id,
                label: c.name ?? c.email ?? c.id,
                hint: c.isActive === false ? "Pending verification or disabled" : c.email ?? undefined,
                disabled: c.isActive === false,
              }))}
              selected={selectedCleaners}
              onChange={setSelectedCleaners}
              placeholder="Select cleaners"
              emptyText="No cleaners found."
            />
            <Button
              className="w-full"
              variant="outline"
              onClick={() => autoAssignTop(2)}
              disabled={autoAssigning}
            >
              {autoAssigning ? "Auto-assigning..." : "Auto Assign Top 2"}
            </Button>
            <Button className="w-full" onClick={assign}>
              Save Assignees
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={qaOpen} onOpenChange={setQaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QA Review</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Score (0-100)</Label>
              <Input type="number" min="0" max="100" value={qaScore} onChange={(e) => setQaScore(e.target.value)} className="mt-1" />
              <p className="mt-1 text-xs text-muted-foreground">Pass threshold: 80%</p>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={qaNotes} onChange={(e) => setQaNotes(e.target.value)} className="mt-1" />
            </div>
            <Button className="w-full" onClick={submitQa}>
              Submit QA
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!continuationDialog} onOpenChange={(open) => { if (!open) setContinuationDialog(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {continuationDialog?.decision === "APPROVE" ? "Approve continuation request" : "Reject continuation request"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {continuationDialog?.decision === "APPROVE" ? (
              <>
                <div className="space-y-1">
                  <Label>New scheduled date</Label>
                  <Input
                    type="date"
                    value={continuationForm.newScheduledDate}
                    onChange={(e) => setContinuationForm((prev) => ({ ...prev, newScheduledDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Assign cleaner</Label>
                  <Select
                    value={continuationForm.newCleanerId || "__none"}
                    onValueChange={(value) =>
                      setContinuationForm((prev) => ({
                        ...prev,
                        newCleanerId: value === "__none" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Leave unassigned</SelectItem>
                      {cleaners
                        .filter((cleaner: any) => cleaner.isActive !== false)
                        .map((cleaner: any) => (
                          <SelectItem key={cleaner.id} value={cleaner.id}>
                            {cleaner.name ?? cleaner.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Previous cleaner paid hours</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.25"
                      value={continuationForm.previousCleanerHours}
                      onChange={(e) =>
                        setContinuationForm((prev) => ({ ...prev, previousCleanerHours: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>New cleaner paid hours</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.25"
                      value={continuationForm.newCleanerHours}
                      onChange={(e) =>
                        setContinuationForm((prev) => ({ ...prev, newCleanerHours: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>New cleaner pay rate (optional)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={continuationForm.newCleanerPayRate}
                      onChange={(e) =>
                        setContinuationForm((prev) => ({ ...prev, newCleanerPayRate: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Transport allowance (optional)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={continuationForm.transportAllowance}
                      onChange={(e) =>
                        setContinuationForm((prev) => ({ ...prev, transportAllowance: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </>
            ) : null}
            <div className="space-y-1">
              <Label>Decision note</Label>
              <Textarea
                value={continuationForm.decisionNote}
                onChange={(e) => setContinuationForm((prev) => ({ ...prev, decisionNote: e.target.value }))}
                placeholder="Optional note"
              />
            </div>
            <Button onClick={submitContinuationDecision} disabled={continuationSubmitting} className="w-full">
              {continuationSubmitting ? "Saving..." : continuationDialog?.decision === "APPROVE" ? "Approve request" : "Reject request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this job"
        description="This permanently removes the job, submissions, QA, time logs, laundry links, and report data."
        confirmLabel="Delete job"
        loading={deletingJob}
        onConfirm={deleteJob}
      />
    </div>
  );
}
