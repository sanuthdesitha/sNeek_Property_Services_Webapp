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
import { ArrowLeft, CalendarClock, RefreshCw, UserPlus, Star, FileText, Send, Pencil, X, Check, Trash2 } from "lucide-react";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { MediaGallery } from "@/components/shared/media-gallery";
import { MultiSelectDropdown } from "@/components/shared/multi-select-dropdown";
import { JobAttachmentsInput } from "@/components/admin/job-attachments-input";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import {
  parseJobInternalNotes,
  summarizeJobRules,
  type JobSpecialRequestTask,
  type JobTimingPreset,
} from "@/lib/jobs/meta";
import { downloadFromApi } from "@/lib/client/download";
import {
  formatAssignmentResponseLabel,
  formatJobStatusLabel,
} from "@/lib/jobs/assignment-workflow";

const STATUS_COLORS: Record<string, any> = {
  UNASSIGNED: "warning",
  OFFERED: "warning",
  ASSIGNED: "secondary",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "destructive",
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

function formatDateTimeLabel(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "dd MMM yyyy HH:mm");
}

function createSpecialRequestTask(): JobSpecialRequestTask {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `admin-task-${suffix}`,
    title: "",
    description: "",
    requiresPhoto: false,
    requiresNote: false,
  };
}

function parseLaundryEventNotes(notes: string | null | undefined) {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

function getLaundryConfirmationLabel(confirmation: any) {
  const meta = parseLaundryEventNotes(confirmation?.notes);
  if (meta?.event === "PICKED_UP") return "Picked up";
  if (meta?.event === "DROPPED") return "Dropped off";
  if (meta?.event === "FAILED_PICKUP_REQUEST") return "Failed pickup request";
  if (meta?.event === "FAILED_PICKUP_RESCHEDULE") return "Failed pickup reschedule";
  if (meta?.event === "FAILED_PICKUP_SKIP_APPROVED") return "Skip approved";
  if (meta?.event === "FAILED_PICKUP_REQUEST_REJECTED") return "Failed pickup rejected";
  return confirmation?.laundryReady ? "Cleaner marked ready" : "Cleaner update";
}

function buildLaundryMediaItems(laundryTask: any) {
  const items: Array<{ id: string; url: string; label: string; mediaType: "PHOTO" }> = [];
  for (const confirmation of Array.isArray(laundryTask?.confirmations) ? laundryTask.confirmations : []) {
    if (!confirmation?.photoUrl) continue;
    items.push({
      id: confirmation.id,
      url: confirmation.photoUrl,
      label: getLaundryConfirmationLabel(confirmation),
      mediaType: "PHOTO",
    });
  }
  if (laundryTask?.receiptImageUrl) {
    items.push({
      id: `${laundryTask.id}-receipt`,
      url: laundryTask.receiptImageUrl,
      label: "Laundry receipt",
      mediaType: "PHOTO",
    });
  }
  return items;
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
  const [updatingReportVisibility, setUpdatingReportVisibility] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingJob, setDeletingJob] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resettingJob, setResettingJob] = useState(false);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [continuationRows, setContinuationRows] = useState<any[]>([]);
  const [continuationLoading, setContinuationLoading] = useState(false);
  const [earlyCheckoutRows, setEarlyCheckoutRows] = useState<any[]>([]);
  const [earlyCheckoutLoading, setEarlyCheckoutLoading] = useState(false);
  const [earlyCheckoutDialogOpen, setEarlyCheckoutDialogOpen] = useState(false);
  const [earlyCheckoutSubmitting, setEarlyCheckoutSubmitting] = useState(false);
  const [earlyCheckoutForm, setEarlyCheckoutForm] = useState({
    requestType: "EARLY_CHECKIN",
    requestedTime: "",
    note: "",
  });
  const [continuationDialog, setContinuationDialog] = useState<{ request: any; decision: "APPROVE" | "REJECT" } | null>(null);
  const [continuationSubmitting, setContinuationSubmitting] = useState(false);
  const [taskReviewDialog, setTaskReviewDialog] = useState<{ task: any; decision: "APPROVE" | "REJECT" } | null>(null);
  const [taskReviewNote, setTaskReviewNote] = useState("");
  const [taskReviewSubmitting, setTaskReviewSubmitting] = useState(false);
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
  const [editingSubmissionId, setEditingSubmissionId] = useState<string | null>(null);
  const [submissionEditData, setSubmissionEditData] = useState<Record<string, any>>({});
  const [submissionEditLaundry, setSubmissionEditLaundry] = useState<{ laundryReady: boolean | null; laundryOutcome: string | null; bagLocation: string }>({ laundryReady: null, laundryOutcome: null, bagLocation: "" });
  const [submissionDeleteMediaIds, setSubmissionDeleteMediaIds] = useState<string[]>([]);
  const [savingSubmission, setSavingSubmission] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleForm, setRescheduleForm] = useState({ date: "", startTime: "", dueTime: "", reason: "" });
  const [rescheduling, setRescheduling] = useState(false);
  const [clearingReschedule, setClearingReschedule] = useState(false);
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
    specialRequestTasks: [] as JobSpecialRequestTask[],
    transportAllowances: {} as Record<string, string>,
    earlyCheckin: { enabled: false, preset: "none" as JobTimingPreset, time: "" },
    lateCheckout: { enabled: false, preset: "none" as JobTimingPreset, time: "" },
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/jobs/${params.id}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.error) {
        setJob({ error: j?.error ?? "Could not load this job." });
        return;
      }

      setJob(j);
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
        specialRequestTasks: Array.isArray(meta.specialRequestTasks) ? meta.specialRequestTasks : [],
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
    } catch (err: any) {
      setJob({ error: err?.message ?? "Could not load this job." });
    } finally {
      setLoading(false);
    }
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

  async function loadEarlyCheckoutRequests() {
    setEarlyCheckoutLoading(true);
    const res = await fetch(`/api/admin/job-early-checkouts?jobId=${params.id}`, { cache: "no-store" });
    const body = await res.json().catch(() => []);
    if (res.ok) {
      setEarlyCheckoutRows(Array.isArray(body) ? body : []);
    } else {
      toast({
        title: "Could not load early checkout requests",
        description: body.error ?? "Please retry.",
        variant: "destructive",
      });
    }
    setEarlyCheckoutLoading(false);
  }

  function openTaskReviewDialog(task: any, decision: "APPROVE" | "REJECT") {
    setTaskReviewDialog({ task, decision });
    setTaskReviewNote("");
  }

  async function reviewClientTaskRequest() {
    if (!taskReviewDialog) return;
    setTaskReviewSubmitting(true);
    const res = await fetch(`/api/admin/job-tasks/${taskReviewDialog.task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: taskReviewDialog.decision,
        note: taskReviewNote.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setTaskReviewSubmitting(false);
    if (!res.ok) {
      toast({
        title: "Task review failed",
        description: body.error ?? "Could not update task request.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: taskReviewDialog.decision === "APPROVE" ? "Task approved" : "Task rejected",
    });
    setTaskReviewDialog(null);
    load();
  }

  useEffect(() => {
    load();
    loadTimeline();
    loadContinuations();
    loadEarlyCheckoutRequests();
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

  async function toggleClientReportVisibility() {
    setUpdatingReportVisibility(true);
    const res = await fetch(`/api/admin/reports/${params.id}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientVisible: !(job?.report?.clientVisible !== false) }),
    });
    const body = await res.json().catch(() => ({}));
    setUpdatingReportVisibility(false);
    if (!res.ok) {
      toast({
        title: "Visibility update failed",
        description: body.error ?? "Could not update client report visibility.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: body.clientVisible ? "Report visible to client" : "Report hidden from client",
    });
    load();
  }

  function startEditSubmission(sub: any) {
    const answers = sub?.data && typeof sub.data === "object" ? { ...sub.data } : {};
    setSubmissionEditData(answers);
    setSubmissionEditLaundry({
      laundryReady: sub.laundryReady ?? null,
      laundryOutcome: sub.laundryOutcome ?? null,
      bagLocation: sub.bagLocation ?? "",
    });
    setSubmissionDeleteMediaIds([]);
    setEditingSubmissionId(sub.id);
  }

  function cancelEditSubmission() {
    setEditingSubmissionId(null);
    setSubmissionEditData({});
    setSubmissionDeleteMediaIds([]);
  }

  async function saveSubmissionEdit(submissionId: string) {
    setSavingSubmission(true);
    try {
      const body: Record<string, any> = {
        data: submissionEditData,
        laundryReady: submissionEditLaundry.laundryReady,
        laundryOutcome: submissionEditLaundry.laundryOutcome || null,
        bagLocation: submissionEditLaundry.bagLocation || null,
      };
      if (submissionDeleteMediaIds.length > 0) {
        body.deleteMediaIds = submissionDeleteMediaIds;
      }
      const res = await fetch(`/api/admin/form-submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Save failed", description: data.error ?? "Could not update submission.", variant: "destructive" });
        return;
      }
      toast({ title: "Submission updated" });
      setEditingSubmissionId(null);
      setSubmissionEditData({});
      setSubmissionDeleteMediaIds([]);
      load();
    } finally {
      setSavingSubmission(false);
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
        specialRequestTasks: editForm.specialRequestTasks
          .map((task) => ({
            ...task,
            title: task.title.trim(),
            description: task.description?.trim() || undefined,
          }))
          .filter((task) => task.title.length > 0),
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

  async function submitEarlyCheckoutRequest() {
    if (!earlyCheckoutForm.requestedTime) {
      toast({ title: "Requested time is required.", variant: "destructive" });
      return;
    }
    setEarlyCheckoutSubmitting(true);
    const res = await fetch("/api/admin/job-early-checkouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: params.id,
        requestType: earlyCheckoutForm.requestType,
        requestedTime: earlyCheckoutForm.requestedTime,
        note: earlyCheckoutForm.note || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setEarlyCheckoutSubmitting(false);
    if (!res.ok) {
      toast({
        title: "Request failed",
        description: body.error ?? "Could not notify cleaners.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Timing update sent to assigned cleaners" });
    setEarlyCheckoutDialogOpen(false);
    setEarlyCheckoutForm({
      requestType: "EARLY_CHECKIN",
      requestedTime: job?.dueTime ?? "",
      note: "",
    });
    await loadEarlyCheckoutRequests();
  }

  async function cancelEarlyCheckoutRequest(requestId: string) {
    const res = await fetch(`/api/admin/job-early-checkouts/${requestId}`, {
      method: "PATCH",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        title: "Could not cancel request",
        description: body.error ?? "Please retry.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Early checkout update cancelled" });
    await loadEarlyCheckoutRequests();
  }

  async function handleReschedule() {
    if (!rescheduleForm.date) {
      toast({ title: "Date required", variant: "destructive" });
      return;
    }
    setRescheduling(true);
    try {
      const res = await fetch(`/api/admin/phase4/reschedule/${job.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: rescheduleForm.date,
          startTime: rescheduleForm.startTime || null,
          dueTime: rescheduleForm.dueTime || null,
          reason: rescheduleForm.reason || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not reschedule.");
      toast({ title: "Job rescheduled" });
      setRescheduleOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Reschedule failed", description: err.message, variant: "destructive" });
    } finally {
      setRescheduling(false);
    }
  }

  async function deleteJob(credentials?: { pin?: string; password?: string }) {
    setDeletingJob(true);
    try {
      const res = await fetch(`/api/admin/jobs/${params.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
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

  async function resetJob(credentials?: { pin?: string; password?: string }) {
    setResettingJob(true);
    try {
      const res = await fetch(`/api/admin/jobs/${params.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not reset job.");
      }
      toast({
        title: "Job reset",
        description: "Assignments and operational progress were cleared, and the job is back to Unassigned.",
      });
      setResetOpen(false);
      load();
      loadTimeline();
      loadContinuations();
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Reset failed",
        description: err.message ?? "Could not reset job.",
        variant: "destructive",
      });
    } finally {
      setResettingJob(false);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!job || job.error) {
    return <div className="p-8 text-destructive">{String(job?.error ?? "Job not found.")}</div>;
  }
  if (!job.property) {
    return (
      <div className="p-8 text-destructive">
        This job is missing its linked property record. Open the jobs list and recreate the job with a valid property.
      </div>
    );
  }
  const jobMeta = job.jobMeta ?? parseJobInternalNotes(job.internalNotes);
  const serviceContext = jobMeta.serviceContext ?? {};
  const reservationContext = jobMeta.reservationContext ?? {};
  const hasServiceContext = Object.keys(serviceContext).length > 0;
  const hasReservationContext = Object.keys(reservationContext).length > 0;
  const preparationGuestCount = Number(reservationContext.preparationGuestCount ?? 0);
  const preparationSource = reservationContext.preparationSource ?? "INCOMING_BOOKING";
  const isAirbnbTurnover = job.jobType === "AIRBNB_TURNOVER";
  const cleanerLookup = new Map(
    cleaners.map((cleaner: any) => [cleaner.id, cleaner.name ?? cleaner.email ?? cleaner.id])
  );
  const transportAllowanceCleanerIds = Array.from(
    new Set([...selectedCleaners, ...Object.keys(editForm.transportAllowances ?? {})])
  );
  const scheduledDateLabel = job?.scheduledDate
    ? (() => {
        const parsed = new Date(job.scheduledDate);
        return Number.isNaN(parsed.getTime()) ? "Date not set" : format(parsed, "EEEE dd MMMM yyyy");
      })()
    : "Date not set";

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
            {scheduledDateLabel}
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
        <Button
          size="sm"
          variant="outline"
            onClick={() => {
              setEarlyCheckoutForm({
                requestType: "EARLY_CHECKIN",
                requestedTime: editForm.dueTime || job.dueTime || "",
                note: "",
              });
              setEarlyCheckoutDialogOpen(true);
            }}
          >
            Request Timing Update
          </Button>
        {job.status === "SUBMITTED" && (
          <Button size="sm" variant="outline" onClick={() => setQaOpen(true)}>
            <Star className="mr-2 h-4 w-4" /> QA Review
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={downloadReport}>
          <FileText className="mr-2 h-4 w-4" /> Download Report
        </Button>
          <Button size="sm" variant="outline" onClick={toggleClientReportVisibility} disabled={!job.report || updatingReportVisibility}>
            {updatingReportVisibility
              ? "Updating..."
              : job.report?.clientVisible !== false
                ? "Hide From Client"
                : "Show To Client"}
          </Button>
          <Button size="sm" variant="outline" onClick={shareReport} disabled={sharing}>
            <Send className="mr-2 h-4 w-4" /> {sharing ? "Sharing..." : "Share To Client"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setResetOpen(true)}>
            Reset Job
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setRescheduleForm({
                date: job.scheduledDate ? toLocalDateInput(job.scheduledDate) : "",
                startTime: job.startTime ?? "",
                dueTime: job.dueTime ?? "",
                reason: "",
              });
              setRescheduleOpen(true);
            }}
          >
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
            Reschedule
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
            Delete Job
          </Button>
        {job.report?.sentToClient && <Badge variant="success">Shared with client</Badge>}
      </div>

      {/* Manually rescheduled notice */}
      {job.manuallyRescheduledAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <CalendarClock className="h-4 w-4 shrink-0" />
            <span>
              Manually rescheduled on{" "}
              {format(new Date(job.manuallyRescheduledAt), "dd MMM yyyy")} — iCal sync will not overwrite this date.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-800 hover:bg-amber-100"
            disabled={clearingReschedule}
            onClick={async () => {
              setClearingReschedule(true);
              const res = await fetch(`/api/admin/jobs/${job.id}/manual-reschedule`, { method: "DELETE" });
              setClearingReschedule(false);
              if (res.ok) {
                toast({ title: "Reset — iCal sync will update this job's dates again." });
                load();
              } else {
                const b = await res.json().catch(() => ({}));
                toast({ title: "Failed", description: b.error ?? "Could not reset.", variant: "destructive" });
              }
            }}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {clearingReschedule ? "Resetting…" : "Reset to iCal"}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Early Checkout Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {earlyCheckoutLoading ? (
            <p className="text-sm text-muted-foreground">Loading requests...</p>
            ) : earlyCheckoutRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No timing updates sent for this job.</p>
            ) : (
              <div className="space-y-2">
                {earlyCheckoutRows.map((row) => (
                <div key={row.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {row.requestType === "LATE_CHECKOUT" ? "Late checkout" : "Early check-in"} request{" "}
                          {row.requestedTime ? `for ${row.requestedTime}` : ""} on{" "}
                          {format(new Date(row.requestedAt), "dd MMM yyyy HH:mm")}
                        </p>
                        {row.note ? <p className="mt-1 text-xs text-muted-foreground">{row.note}</p> : null}
                        {row.decidedAt ? (
                          <p className="mt-1 text-xs text-emerald-700">
                            {row.status === "APPROVED" ? "Approved" : row.status === "DECLINED" ? "Declined" : "Updated"}{" "}
                            {format(new Date(row.decidedAt), "dd MMM yyyy HH:mm")}
                          </p>
                        ) : null}
                        {row.cancelledAt ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Cancelled {format(new Date(row.cancelledAt), "dd MMM yyyy HH:mm")}
                        </p>
                      ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            row.status === "PENDING"
                              ? ("warning" as any)
                              : row.status === "APPROVED"
                                ? "success"
                                : "secondary"
                          }
                        >
                          {row.status}
                        </Badge>
                        {row.status === "PENDING" ? (
                        <Button size="sm" variant="ghost" onClick={() => cancelEarlyCheckoutRequest(row.id)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {hasServiceContext ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">Operational Context</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {serviceContext.scopeOfWork ? <div><p className="text-xs text-muted-foreground">Scope of work</p><p className="text-sm">{serviceContext.scopeOfWork}</p></div> : null}
            {serviceContext.accessInstructions ? <div><p className="text-xs text-muted-foreground">Access instructions</p><p className="text-sm">{serviceContext.accessInstructions}</p></div> : null}
            {serviceContext.parkingInstructions ? <div><p className="text-xs text-muted-foreground">Parking / arrival</p><p className="text-sm">{serviceContext.parkingInstructions}</p></div> : null}
            {serviceContext.hazardNotes ? <div><p className="text-xs text-muted-foreground">Hazards / safety</p><p className="text-sm">{serviceContext.hazardNotes}</p></div> : null}
            {serviceContext.equipmentNotes ? <div><p className="text-xs text-muted-foreground">Equipment / utilities</p><p className="text-sm">{serviceContext.equipmentNotes}</p></div> : null}
            {serviceContext.siteContactName || serviceContext.siteContactPhone ? (
              <div>
                <p className="text-xs text-muted-foreground">On-site contact</p>
                <p className="text-sm">{[serviceContext.siteContactName, serviceContext.siteContactPhone].filter(Boolean).join(" · ")}</p>
              </div>
            ) : null}
            {serviceContext.serviceAreaSqm ? <div><p className="text-xs text-muted-foreground">Service area</p><p className="text-sm">{serviceContext.serviceAreaSqm} sqm</p></div> : null}
            {serviceContext.floorCount ? <div><p className="text-xs text-muted-foreground">Floors / levels</p><p className="text-sm">{serviceContext.floorCount}</p></div> : null}
          </CardContent>
        </Card>
      ) : null}

      {hasReservationContext ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {preparationSource === "PROPERTY_MAX" ? "Preparation Details" : "Incoming Booking Details"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {reservationContext.guestName ? <div><p className="text-xs text-muted-foreground">Guest name</p><p className="text-sm">{reservationContext.guestName}</p></div> : null}
            {reservationContext.reservationCode ? <div><p className="text-xs text-muted-foreground">Reservation code</p><p className="text-sm">{reservationContext.reservationCode}</p></div> : null}
            {preparationGuestCount > 0 ? (
              <div>
                <p className="text-xs text-muted-foreground">Preparation guest count</p>
                <p className="text-sm">
                  {preparationGuestCount} guest{preparationGuestCount === 1 ? "" : "s"}
                  {preparationSource === "PROPERTY_MAX" ? " · property max fallback" : ""}
                  {preparationSource !== "PROPERTY_MAX" && reservationContext.adults != null ? ` · ${reservationContext.adults} adults` : ""}
                  {preparationSource !== "PROPERTY_MAX" && reservationContext.children != null ? ` · ${reservationContext.children} children` : ""}
                  {preparationSource !== "PROPERTY_MAX" && reservationContext.infants != null ? ` · ${reservationContext.infants} infants` : ""}
                </p>
              </div>
            ) : null}
            {preparationSource === "PROPERTY_MAX" ? (
              <div>
                <p className="text-xs text-muted-foreground">Booking status</p>
                <p className="text-sm">No same-day incoming booking linked. Prepare for maximum occupancy.</p>
              </div>
            ) : null}
            {reservationContext.guestPhone ? <div><p className="text-xs text-muted-foreground">Guest phone</p><p className="text-sm">{reservationContext.guestPhone}</p></div> : null}
            {reservationContext.guestEmail ? <div><p className="text-xs text-muted-foreground">Guest email</p><p className="text-sm">{reservationContext.guestEmail}</p></div> : null}
            {reservationContext.checkinAtLocal ? <div><p className="text-xs text-muted-foreground">Check-in</p><p className="text-sm">{formatDateTimeLabel(reservationContext.checkinAtLocal)}</p></div> : null}
            {reservationContext.checkoutAtLocal ? <div><p className="text-xs text-muted-foreground">Checkout</p><p className="text-sm">{formatDateTimeLabel(reservationContext.checkoutAtLocal)}</p></div> : null}
            {reservationContext.locationText ? <div><p className="text-xs text-muted-foreground">Location / booking details</p><p className="text-sm">{reservationContext.locationText}</p></div> : null}
            {reservationContext.guestProfileUrl ? (
              <div>
                <p className="text-xs text-muted-foreground">Guest profile</p>
                <a className="text-sm text-primary underline underline-offset-4" href={reservationContext.guestProfileUrl} target="_blank" rel="noreferrer">
                  Open profile
                </a>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
          <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm">Admin requested tasks</Label>
                <p className="text-xs text-muted-foreground">
                  These appear only on this job as required high-priority cleaner tasks.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditForm((prev) => ({
                    ...prev,
                    specialRequestTasks: [...prev.specialRequestTasks, createSpecialRequestTask()],
                  }))
                }
              >
                Add task
              </Button>
            </div>
            {editForm.specialRequestTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No job-specific special request tasks added.</p>
            ) : (
              <div className="space-y-3">
                {editForm.specialRequestTasks.map((task, index) => (
                  <div key={task.id} className="space-y-3 rounded-md border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Task {index + 1}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            specialRequestTasks: prev.specialRequestTasks.filter((row) => row.id !== task.id),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label>Task title</Label>
                      <Input
                        value={task.title}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            specialRequestTasks: prev.specialRequestTasks.map((row) =>
                              row.id === task.id ? { ...row, title: e.target.value } : row
                            ),
                          }))
                        }
                        placeholder="Example: Photograph inside oven after deep clean"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Instructions</Label>
                      <Textarea
                        value={task.description ?? ""}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            specialRequestTasks: prev.specialRequestTasks.map((row) =>
                              row.id === task.id ? { ...row, description: e.target.value } : row
                            ),
                          }))
                        }
                        placeholder="Explain exactly what must be checked or completed"
                      />
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={task.requiresPhoto}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              specialRequestTasks: prev.specialRequestTasks.map((row) =>
                                row.id === task.id ? { ...row, requiresPhoto: e.target.checked } : row
                              ),
                            }))
                          }
                        />
                        Require image proof
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={task.requiresNote}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              specialRequestTasks: prev.specialRequestTasks.map((row) =>
                                row.id === task.id ? { ...row, requiresNote: e.target.checked } : row
                              ),
                            }))
                          }
                        />
                        Require cleaner note
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
          {isAirbnbTurnover ? (
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
          ) : null}
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
              {(jobMeta.specialRequestTasks?.length ?? 0) > 0 ? (
                <div className="space-y-2 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                    Admin Requested Tasks
                  </p>
                  <div className="space-y-2">
                    {jobMeta.specialRequestTasks?.map((task: JobSpecialRequestTask) => (
                      <div key={task.id} className="rounded-md border bg-background px-3 py-2 text-sm">
                        <p className="font-medium">{task.title}</p>
                        {task.description ? (
                          <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="destructive">Required</Badge>
                          {task.requiresPhoto ? <Badge variant="outline">Image proof</Badge> : null}
                          {task.requiresNote ? <Badge variant="outline">Cleaner note</Badge> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {(job.jobTasks ?? []).filter((task: any) => task.source === "CLIENT").length > 0 ? (
                <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Client Task Requests
                  </p>
                  <div className="space-y-2">
                    {(job.jobTasks ?? [])
                      .filter((task: any) => task.source === "CLIENT")
                      .map((task: any) => (
                        <div key={task.id} className="space-y-2 rounded-md border bg-background px-3 py-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{task.title}</p>
                              {task.description ? (
                                <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                              ) : null}
                              <p className="mt-1 text-xs text-muted-foreground">
                                Requested by {task.requestedBy?.name || task.requestedBy?.email || "Client"} on{" "}
                                {format(new Date(task.createdAt), "dd MMM yyyy HH:mm")}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">{String(task.approvalStatus).replace(/_/g, " ")}</Badge>
                              <Badge variant="outline">{String(task.executionStatus).replace(/_/g, " ")}</Badge>
                              {task.requiresPhoto ? <Badge variant="outline">Photo proof</Badge> : null}
                              {task.requiresNote ? <Badge variant="outline">Cleaner note</Badge> : null}
                            </div>
                          </div>
                          {Array.isArray(task.attachments) && task.attachments.length > 0 ? (
                            <MediaGallery
                              items={task.attachments.map((attachment: any) => ({
                                id: attachment.id,
                                url: attachment.url,
                                label: attachment.label || "Client reference",
                                mediaType: attachment.mediaType,
                              }))}
                              title="Client reference files"
                              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                            />
                          ) : null}
                          {task.approvalStatus === "PENDING_APPROVAL" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => openTaskReviewDialog(task, "APPROVE")}>
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openTaskReviewDialog(task, "REJECT")}>
                                Reject
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                  </div>
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
                        <Badge variant={a.responseStatus === "PENDING" ? "warning" : "outline"}>
                          {formatAssignmentResponseLabel(a.responseStatus)}
                        </Badge>
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
                const isEditing = editingSubmissionId === sub.id;
                const answers = isEditing ? submissionEditData : (sub?.data && typeof sub.data === "object" ? sub.data : {});
                const sections = Array.isArray(sub?.template?.schema?.sections) ? sub.template.schema.sections : [];
                const property = (job?.property ?? {}) as Record<string, unknown>;

                return (
                  <Card key={sub.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          {sub.template?.name} - by {sub.submittedBy?.name} - {format(new Date(sub.createdAt), "dd MMM HH:mm")}
                        </CardTitle>
                        {!isEditing ? (
                          <Button size="sm" variant="outline" onClick={() => startEditSubmission(sub)}>
                            <Pencil className="mr-1 h-3 w-3" />
                            Edit
                          </Button>
                        ) : (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={cancelEditSubmission} disabled={savingSubmission}>
                              <X className="mr-1 h-3 w-3" />
                              Cancel
                            </Button>
                            <Button size="sm" onClick={() => saveSubmissionEdit(sub.id)} disabled={savingSubmission}>
                              <Check className="mr-1 h-3 w-3" />
                              {savingSubmission ? "Saving..." : "Save changes"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {isEditing ? (
                        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                          <p className="text-xs font-medium text-muted-foreground">Laundry &amp; bag details</p>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Laundry ready</Label>
                              <Select
                                value={submissionEditLaundry.laundryReady === null ? "null" : submissionEditLaundry.laundryReady ? "true" : "false"}
                                onValueChange={(v) => setSubmissionEditLaundry((prev) => ({ ...prev, laundryReady: v === "null" ? null : v === "true" }))}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="null">Not set</SelectItem>
                                  <SelectItem value="true">Ready</SelectItem>
                                  <SelectItem value="false">Not ready</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Laundry outcome</Label>
                              <Select
                                value={submissionEditLaundry.laundryOutcome ?? "null"}
                                onValueChange={(v) => setSubmissionEditLaundry((prev) => ({ ...prev, laundryOutcome: v === "null" ? null : v }))}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="null">Not set</SelectItem>
                                  <SelectItem value="PENDING">Pending</SelectItem>
                                  <SelectItem value="COLLECTED">Collected</SelectItem>
                                  <SelectItem value="DELIVERED">Delivered</SelectItem>
                                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Bag location</Label>
                              <Input
                                value={submissionEditLaundry.bagLocation}
                                onChange={(e) => setSubmissionEditLaundry((prev) => ({ ...prev, bagLocation: e.target.value }))}
                                placeholder="e.g. front door"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {sub.laundryReady !== null && (
                            <Badge variant={sub.laundryReady ? "default" : "secondary"}>
                              Laundry {sub.laundryReady ? "Ready" : "Not ready"}
                            </Badge>
                          )}
                          {sub.bagLocation ? <span className="text-xs text-muted-foreground">Bag location: {sub.bagLocation}</span> : null}
                        </div>
                      )}

                      {!isEditing && (
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
                      )}

                      <div className="space-y-4">
                        {sections
                          .filter((section: any) => isConditionMet(section?.conditional, isEditing ? submissionEditData : answers, property))
                          .map((section: any) => {
                            const fields = (Array.isArray(section?.fields) ? section.fields : []).filter((field: any) =>
                              isConditionMet(field?.conditional, isEditing ? submissionEditData : answers, property)
                            );
                            if (fields.length === 0) return null;

                            return (
                              <div key={section.id} className="rounded-md border">
                                <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">{section.label}</div>
                                <div className="divide-y">
                                  {fields.map((field: any) => {
                                    const fieldAnswers = isEditing ? submissionEditData : (sub?.data && typeof sub.data === "object" ? sub.data : {});
                                    const isCheckbox = field.type === "checkbox";
                                    const isUpload = field.type === "upload";
                                    const isTextarea = field.type === "textarea";
                                    const isReadOnly = field.type === "inventory" || field.type === "laundry_confirm";
                                    const checked = isCheckbox ? fieldAnswers[field.id] === true : false;
                                    const label = isCheckbox && !isEditing
                                      ? `${checkboxMark(checked)} ${String(field.label ?? field.id ?? "Checklist item")}`
                                      : String(field.label ?? field.id ?? "Checklist item");
                                    const value = renderFieldValue(field, sub);
                                    const mediaForField = (sub.media ?? []).filter((m: any) => m.fieldId === field.id);
                                    const pendingDelete = submissionDeleteMediaIds;

                                    if (isEditing && !isReadOnly) {
                                      return (
                                        <div key={field.id} className="px-3 py-2 space-y-1.5">
                                          <Label className="text-sm">{String(field.label ?? field.id ?? "Field")}</Label>
                                          {isCheckbox && (
                                            <div className="flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                id={`sub-field-${field.id}`}
                                                checked={submissionEditData[field.id] === true}
                                                onChange={(e) => setSubmissionEditData((prev) => ({ ...prev, [field.id]: e.target.checked }))}
                                                className="h-4 w-4"
                                              />
                                              <label htmlFor={`sub-field-${field.id}`} className="text-sm text-muted-foreground">
                                                {field.label ?? field.id}
                                              </label>
                                            </div>
                                          )}
                                          {isTextarea && (
                                            <Textarea
                                              value={String(submissionEditData[field.id] ?? "")}
                                              onChange={(e) => setSubmissionEditData((prev) => ({ ...prev, [field.id]: e.target.value }))}
                                              rows={3}
                                            />
                                          )}
                                          {!isCheckbox && !isTextarea && !isUpload && (
                                            <Input
                                              value={String(submissionEditData[field.id] ?? "")}
                                              onChange={(e) => setSubmissionEditData((prev) => ({ ...prev, [field.id]: e.target.value }))}
                                            />
                                          )}
                                          {isUpload && mediaForField.length > 0 && (
                                            <div className="space-y-1">
                                              <p className="text-xs text-muted-foreground">Existing media (click to remove)</p>
                                              <div className="flex flex-wrap gap-2">
                                                {mediaForField.map((m: any) => {
                                                  const marked = pendingDelete.includes(m.id);
                                                  return (
                                                    <div key={m.id} className="relative">
                                                      <img
                                                        src={m.url}
                                                        alt={m.label ?? m.fieldId}
                                                        className={`h-16 w-16 rounded object-cover border ${marked ? "opacity-40 ring-2 ring-destructive" : ""}`}
                                                      />
                                                      <button
                                                        type="button"
                                                        className="absolute -top-1 -right-1 rounded-full bg-destructive text-destructive-foreground p-0.5"
                                                        onClick={() =>
                                                          setSubmissionDeleteMediaIds((prev) =>
                                                            marked ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                                                          )
                                                        }
                                                      >
                                                        <Trash2 className="h-3 w-3" />
                                                      </button>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }

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
              <CardContent className="space-y-4 pt-4 text-sm">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <div className="mt-1">
                      <Badge>{job.laundryTask.status.replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Pickup</p>
                    <p className="mt-1 font-medium">{format(new Date(job.laundryTask.pickupDate), "EEE dd MMM yyyy")}</p>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Drop-off</p>
                    <p className="mt-1 font-medium">{format(new Date(job.laundryTask.dropoffDate), "EEE dd MMM yyyy")}</p>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Supplier</p>
                    <p className="mt-1 font-medium">{job.laundryTask.supplier?.name || "Not assigned"}</p>
                  </div>
                </div>

                {job.laundryTask.flagReason || job.laundryTask.status === "SKIPPED_PICKUP" ? (
                  <div
                    className={`rounded-lg border p-3 ${
                      job.laundryTask.status === "SKIPPED_PICKUP"
                        ? "border-amber-300 bg-amber-50"
                        : "border-destructive/30 bg-destructive/10"
                    }`}
                  >
                    {job.laundryTask.flagReason ? (
                      <p className="font-medium text-destructive">{job.laundryTask.flagReason.replace(/_/g, " ")}</p>
                    ) : null}
                    {job.laundryTask.flagNotes ? (
                      <p className="mt-1 text-xs text-muted-foreground">{job.laundryTask.flagNotes}</p>
                    ) : null}
                    {job.laundryTask.status === "SKIPPED_PICKUP" ? (
                      <div className="mt-2 space-y-1 text-xs text-amber-900">
                        <p>
                          Skip reason: {String(job.laundryTask.skipReasonCode || "Not set").replace(/_/g, " ")}
                        </p>
                        {job.laundryTask.skipReasonNote ? <p>Cleaner note: {job.laundryTask.skipReasonNote}</p> : null}
                        {job.laundryTask.adminOverrideNote ? <p>Admin note: {job.laundryTask.adminOverrideNote}</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {(job.laundryTask.bagWeightKg != null ||
                  job.laundryTask.dropoffCostAud != null ||
                  job.laundryTask.receiptImageUrl) ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Bag weight</p>
                      <p className="mt-1 font-medium">
                        {job.laundryTask.bagWeightKg != null ? `${Number(job.laundryTask.bagWeightKg).toFixed(2)} kg` : "-"}
                      </p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Drop-off cost</p>
                      <p className="mt-1 font-medium">
                        {job.laundryTask.dropoffCostAud != null ? `$${Number(job.laundryTask.dropoffCostAud).toFixed(2)}` : "-"}
                      </p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Receipt</p>
                      {job.laundryTask.receiptImageUrl ? (
                        <a href={job.laundryTask.receiptImageUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-primary hover:underline">
                          Open receipt image
                        </a>
                      ) : (
                        <p className="mt-1 font-medium">-</p>
                      )}
                    </div>
                  </div>
                ) : null}

                {buildLaundryMediaItems(job.laundryTask).length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Laundry evidence</p>
                    <MediaGallery
                      items={buildLaundryMediaItems(job.laundryTask)}
                      emptyText="No laundry evidence yet."
                      title="Laundry Evidence"
                      className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4"
                    />
                  </div>
                ) : null}

                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Laundry timeline</p>
                  {Array.isArray(job.laundryTask.confirmations) && job.laundryTask.confirmations.length > 0 ? (
                    <div className="space-y-2">
                      {job.laundryTask.confirmations.map((confirmation: any) => {
                        const meta = parseLaundryEventNotes(confirmation?.notes);
                        return (
                          <div key={confirmation.id} className="rounded-md border bg-muted/20 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium">{getLaundryConfirmationLabel(confirmation)}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(confirmation.createdAt), "dd MMM yyyy HH:mm")}
                              </p>
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              {confirmation.bagLocation ? <p>Bag location: {confirmation.bagLocation}</p> : null}
                              {confirmation.notes && !meta?.event ? <p>Note: {confirmation.notes}</p> : null}
                              {meta?.dropoffLocation ? <p>Drop-off location: {meta.dropoffLocation}</p> : null}
                              {meta?.bagCount ? <p>Bag count: {meta.bagCount}</p> : null}
                              {typeof meta?.totalPrice === "number" ? <p>Total price: ${Number(meta.totalPrice).toFixed(2)}</p> : null}
                              {meta?.reason ? <p>Reason: {meta.reason}</p> : null}
                              {meta?.resolutionNotes ? <p>Resolution: {meta.resolutionNotes}</p> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No laundry confirmations recorded yet.</p>
                  )}
                </div>
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

      <Dialog open={earlyCheckoutDialogOpen} onOpenChange={setEarlyCheckoutDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Timing Update</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Update type</Label>
              <Select
                value={earlyCheckoutForm.requestType}
                onValueChange={(value) =>
                  setEarlyCheckoutForm((prev) => ({
                    ...prev,
                    requestType: value,
                    requestedTime:
                      value === "LATE_CHECKOUT"
                        ? editForm.startTime || job.startTime || prev.requestedTime
                        : editForm.dueTime || job.dueTime || prev.requestedTime,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EARLY_CHECKIN">Early check-in</SelectItem>
                  <SelectItem value="LATE_CHECKOUT">Late checkout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{earlyCheckoutForm.requestType === "LATE_CHECKOUT" ? "Revised start time" : "Revised due time"}</Label>
              <Input
                type="time"
                value={earlyCheckoutForm.requestedTime}
                onChange={(e) => setEarlyCheckoutForm((prev) => ({ ...prev, requestedTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Cleaner note</Label>
              <Textarea
                value={earlyCheckoutForm.note}
                onChange={(e) => setEarlyCheckoutForm((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Explain the late change or access update for the assigned cleaner."
              />
            </div>
            <Button className="w-full" onClick={submitEarlyCheckoutRequest} disabled={earlyCheckoutSubmitting}>
              {earlyCheckoutSubmitting ? "Sending..." : "Send approval request"}
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

      <Dialog open={Boolean(taskReviewDialog)} onOpenChange={(open) => !open && setTaskReviewDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {taskReviewDialog?.decision === "APPROVE" ? "Approve client task request" : "Reject client task request"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="font-medium">{taskReviewDialog?.task?.title}</p>
              {taskReviewDialog?.task?.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{taskReviewDialog.task.description}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Decision note</Label>
              <Textarea
                value={taskReviewNote}
                onChange={(e) => setTaskReviewNote(e.target.value)}
                placeholder="Optional note for the client and assigned cleaners"
              />
            </div>
            <Button onClick={reviewClientTaskRequest} disabled={taskReviewSubmitting} className="w-full">
              {taskReviewSubmitting
                ? "Saving..."
                : taskReviewDialog?.decision === "APPROVE"
                  ? "Approve request"
                  : "Reject request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reschedule Dialog ── */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Reschedule Job
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="rs-date">New date <span className="text-destructive">*</span></Label>
              <Input
                id="rs-date"
                type="date"
                value={rescheduleForm.date}
                onChange={(e) => setRescheduleForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rs-start">Start time (optional)</Label>
                <Input
                  id="rs-start"
                  type="time"
                  value={rescheduleForm.startTime}
                  onChange={(e) => setRescheduleForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rs-due">Due time (optional)</Label>
                <Input
                  id="rs-due"
                  type="time"
                  value={rescheduleForm.dueTime}
                  onChange={(e) => setRescheduleForm((f) => ({ ...f, dueTime: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-reason">Reason (optional)</Label>
              <Textarea
                id="rs-reason"
                rows={3}
                placeholder="Reason for rescheduling…"
                value={rescheduleForm.reason}
                onChange={(e) => setRescheduleForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Once rescheduled, iCal sync will not overwrite this date. Use "Reset to iCal" to undo.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setRescheduleOpen(false)} disabled={rescheduling}>
                Cancel
              </Button>
              <Button onClick={handleReschedule} disabled={rescheduling || !rescheduleForm.date}>
                {rescheduling ? "Rescheduling…" : "Apply Reschedule"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this job"
        description="This permanently removes the job, submissions, QA, time logs, laundry links, and report data."
        actionKey="deleteJob"
        confirmLabel="Delete job"
        requireSecurityVerification
        loading={deletingJob}
        onConfirm={deleteJob}
      />
      <TwoStepConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset this job"
        description="This resets the job back to Unassigned, removes all assigned cleaners, clears submissions, reports, QA, laundry progress, time logs, and restores deducted inventory."
        actionKey="resetJob"
        confirmLabel="Reset job"
        requireSecurityVerification
        loading={resettingJob}
        onConfirm={resetJob}
      />
    </div>
  );
}
