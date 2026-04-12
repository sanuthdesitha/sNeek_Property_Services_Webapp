"use client";

import { useMemo, useState, useEffect } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Download, Mail, Plus, RefreshCw, Shirt, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { MediaGallery } from "@/components/shared/media-gallery";
import { toast } from "@/hooks/use-toast";
import { LAUNDRY_SKIP_REASONS } from "@/lib/laundry/constants";

const ADMIN_LAUNDRY_TAB_KEY = "sneek_admin_laundry_tab_v1";

const FLAG_LABELS: Record<string, string> = {
  NO_WINDOW: "No window",
  BUFFER_REQUIRED: "Use buffer linen",
  EXPRESS_OR_EXTRA_LINEN_REQUIRED: "Express / extra linen required",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "secondary",
  CONFIRMED: "default",
  PICKED_UP: "default",
  DROPPED: "success",
  FLAGGED: "destructive",
  SKIPPED_PICKUP: "warning",
};

function parseEventNotes(notes: string | null | undefined) {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

function getEventConfirmation(task: any, eventName: string) {
  const confirmations = Array.isArray(task?.confirmations) ? [...task.confirmations] : [];
  return confirmations.reverse().find((confirmation: any) => {
    const meta = parseEventNotes(confirmation.notes);
    return meta?.event === eventName;
  });
}

function getCleanerLaundryConfirmation(task: any) {
  const confirmations = Array.isArray(task?.confirmations) ? task.confirmations : [];
  return confirmations.find((confirmation: any) => {
    const meta = parseEventNotes(confirmation.notes);
    return confirmation?.laundryReady === true && Boolean(confirmation?.photoUrl) && !meta?.event;
  });
}

function buildTimeline(task: any) {
  const events: Array<{ at: Date; label: string }> = [];
  if (task.createdAt) events.push({ at: new Date(task.createdAt), label: "Task created" });
  if (task.confirmedAt) events.push({ at: new Date(task.confirmedAt), label: "Laundry confirmed by cleaner" });
  if (Array.isArray(task.confirmations)) {
    for (const confirmation of task.confirmations) {
      const meta = parseEventNotes(confirmation.notes);
      if (meta?.event === "PICKED_UP") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Picked up${meta.bagCount ? ` (${meta.bagCount} bag${meta.bagCount > 1 ? "s" : ""})` : ""}`,
        });
        continue;
      }
      if (meta?.event === "DROPPED") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Returned${meta.dropoffLocation ? ` to ${meta.dropoffLocation}` : ""}${
            typeof meta.totalPrice === "number" ? ` ($${Number(meta.totalPrice).toFixed(2)})` : ""
          }`,
        });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_RESCHEDULE") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Failed pickup rescheduled to ${
            meta.rescheduledPickupDate ? format(new Date(meta.rescheduledPickupDate), "dd MMM") : "a new date"
          }${meta.reason ? ` (${meta.reason})` : ""}`,
        });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_REQUEST") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Failed pickup approval requested for ${String(meta.requestedAction ?? "SKIP").toLowerCase()}${
            meta.reason ? ` (${meta.reason})` : ""
          }`,
        });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_SKIP_APPROVED") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Skip approved${meta.resolutionNotes ? ` (${meta.resolutionNotes})` : ""}`,
        });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_REQUEST_REJECTED") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Failed pickup request rejected${meta.resolutionNotes ? ` (${meta.resolutionNotes})` : ""}`,
        });
        continue;
      }
      events.push({
        at: new Date(confirmation.createdAt),
        label: confirmation.laundryReady
          ? `Cleaner marked ready${confirmation.bagLocation ? ` (${confirmation.bagLocation})` : ""}`
          : "Cleaner marked not ready",
      });
    }
  }
  if (task.pickedUpAt) events.push({ at: new Date(task.pickedUpAt), label: "Picked up" });
  if (task.droppedAt) events.push({ at: new Date(task.droppedAt), label: "Returned" });
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function getPendingFailedPickupRequest(task: any) {
  const confirmations = Array.isArray(task?.confirmations) ? [...task.confirmations] : [];
  const row = confirmations.reverse().find((confirmation: any) => {
    const meta = parseEventNotes(confirmation?.notes);
    return meta?.event === "FAILED_PICKUP_REQUEST" && meta?.approvalStatus === "PENDING";
  });
  return row ? parseEventNotes(row.notes) : null;
}

function dateInputValue(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "yyyy-MM-dd");
}

function toDateOnlyIso(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Keep date-only values stable across timezones for planner/edit flows.
  return `${value}T00:00:00.000Z`;
}

export default function LaundryPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [generating, setGenerating] = useState(false);
  const [editTask, setEditTask] = useState<any | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [approvingFailedPickupTaskId, setApprovingFailedPickupTaskId] = useState<string | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<any | null>(null);
  const [draftPlan, setDraftPlan] = useState<any[]>([]);
  const [draftOpen, setDraftOpen] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [draftSource, setDraftSource] = useState<"MANUAL" | "SYNC_PENDING">("MANUAL");
  const [pendingSyncDraft, setPendingSyncDraft] = useState<{
    updatedAt: string | null;
    itemCount: number;
    propertyCount: number;
    createCount: number;
    updateCount: number;
    items: any[];
  } | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"daily" | "weekly" | "monthly" | "annual" | "custom">("weekly");
  const [reportAnchorDate, setReportAnchorDate] = useState(() => dateInputValue(new Date()));
  const [reportStartDate, setReportStartDate] = useState(() => dateInputValue(weekStart));
  const [reportEndDate, setReportEndDate] = useState(() => dateInputValue(addDays(weekStart, 6)));
  const [reportRecipientMode, setReportRecipientMode] = useState<"CUSTOM" | string>("CUSTOM");
  const [reportEmail, setReportEmail] = useState("");
  const [reportPreview, setReportPreview] = useState<any | null>(null);
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDownloading, setReportDownloading] = useState(false);
  const [reportEmailing, setReportEmailing] = useState(false);
  const [reportTargetTask, setReportTargetTask] = useState<any | null>(null);
  const [reportHistory, setReportHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reportHistoryOpen, setReportHistoryOpen] = useState(false);
  const [replacingConfirmationId, setReplacingConfirmationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [propertyFilter, setPropertyFilter] = useState<string>("ALL");
  const [clientFilter, setClientFilter] = useState<string>("ALL");
  const [activeScheduleTab, setActiveScheduleTab] = useState<"active" | "completed">("active");
  const [editForm, setEditForm] = useState({
    pickupDate: "",
    dropoffDate: "",
    status: "PENDING",
    flagNotes: "",
    skipReasonCode: "NONE",
    skipReasonNote: "",
    adminOverrideNote: "",
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [createForm, setCreateForm] = useState({
    propertyId: "",
    jobId: "",
    pickupDate: "",
    dropoffDate: "",
    flagNotes: "",
  });
  const [properties, setProperties] = useState<Array<{ id: string; name: string; suburb: string; clientId: string | null }>>([]);
  const [propertyJobs, setPropertyJobs] = useState<Array<{ id: string; jobNumber: string; jobType: string; scheduledDate: string }>>([]);

  function fetchTasks() {
    fetch(`/api/laundry/week?start=${weekStart.toISOString()}`).then((r) => r.json()).then(setTasks);
    fetch("/api/admin/laundry/alerts").then((r) => r.json()).then(setAlerts);
  }

  function fetchClients() {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((body) => {
        const rows = Array.isArray(body) ? body : [];
        setClients(
          rows
            .filter((client) => typeof client?.email === "string" && client.email.trim())
            .map((client) => ({
              id: client.id,
              name: client.name,
              email: client.email,
            }))
        );
      });
  }

  function fetchProperties() {
    fetch("/api/admin/properties")
      .then((r) => r.json())
      .then((body) => {
        const rows = Array.isArray(body) ? body : [];
        setProperties(
          rows
            .filter((p: any) => p?.id)
            .map((p: any) => ({
              id: p.id,
              name: p.name || "Unnamed",
              suburb: p.suburb || "",
              clientId: p.clientId ?? null,
            }))
        );
      })
      .catch(() => setProperties([]));
  }

  function fetchPropertyJobs(propertyId: string) {
    if (!propertyId) {
      setPropertyJobs([]);
      return;
    }
    fetch(`/api/jobs?propertyId=${propertyId}&limit=50`)
      .then((r) => r.json())
      .then((body) => {
        const rows = Array.isArray(body?.jobs) ? body.jobs : [];
        setPropertyJobs(
          rows
            .filter((j: any) => j?.id && j?.status !== "COMPLETED" && j?.status !== "INVOICED")
            .map((j: any) => ({
              id: j.id,
              jobNumber: j.jobNumber || j.id.slice(-6),
              jobType: j.jobType || "",
              scheduledDate: j.scheduledDate || "",
            }))
        );
      })
      .catch(() => setPropertyJobs([]));
  }

  async function createLaundryTask() {
    if (!createForm.propertyId || !createForm.pickupDate || !createForm.dropoffDate) {
      toast({ title: "Missing fields", description: "Property, pickup date, and drop-off date are required.", variant: "destructive" });
      return;
    }
    setCreatingTask(true);
    try {
      const res = await fetch("/api/admin/laundry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: createForm.propertyId,
          jobId: createForm.jobId || null,
          pickupDate: toDateOnlyIso(createForm.pickupDate) ?? createForm.pickupDate,
          dropoffDate: toDateOnlyIso(createForm.dropoffDate) ?? createForm.dropoffDate,
          flagNotes: createForm.flagNotes || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not create laundry task.");
      }
      toast({ title: "Laundry task created" });
      setCreateOpen(false);
      setCreateForm({ propertyId: "", jobId: "", pickupDate: "", dropoffDate: "", flagNotes: "" });
      fetchTasks();
    } catch (error: any) {
      toast({ title: "Create failed", description: error?.message ?? "Could not create laundry task.", variant: "destructive" });
    } finally {
      setCreatingTask(false);
    }
  }

  function fetchReportHistory() {
    setHistoryLoading(true);
    fetch("/api/admin/laundry/reports/history?limit=20")
      .then((r) => r.json())
      .then((body) => setReportHistory(Array.isArray(body) ? body : []))
      .finally(() => setHistoryLoading(false));
  }

  function fetchPendingSyncDraft() {
    fetch("/api/admin/laundry/generate-week")
      .then((r) => r.json())
      .then((body) => {
        const pending = body?.pendingSyncDraft;
        if (!pending || typeof pending !== "object") {
          setPendingSyncDraft(null);
          return;
        }
        setPendingSyncDraft({
          updatedAt: typeof pending.updatedAt === "string" ? pending.updatedAt : null,
          itemCount: Number(pending.itemCount ?? 0),
          propertyCount: Number(pending.propertyCount ?? 0),
          createCount: Number(pending.createCount ?? 0),
          updateCount: Number(pending.updateCount ?? 0),
          items: Array.isArray(pending.items) ? pending.items : [],
        });
      })
      .catch(() => setPendingSyncDraft(null));
  }

  function updateDraftItem(index: number, patch: Record<string, any>) {
    setDraftPlan((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function removeDraftItem(index: number) {
    setDraftPlan((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  const propertyOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; suburb: string }>();
    for (const task of tasks) {
      if (task?.property?.id && !map.has(task.property.id)) {
        map.set(task.property.id, {
          id: task.property.id,
          name: task.property.name,
          suburb: task.property.suburb,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const task of tasks) {
      if (task?.property?.client?.id && !map.has(task.property.client.id)) {
        map.set(task.property.client.id, {
          id: task.property.client.id,
          name: task.property.client.name || task.property.client.email || "Client",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  function buildReportQuery(taskId?: string) {
    const params = new URLSearchParams();
    params.set("period", reportPeriod);
    if (taskId) {
      params.set("taskId", taskId);
      return params.toString();
    }
    params.set("includePending", "true");
    if (reportPeriod === "custom") {
      if (reportStartDate) params.set("startDate", reportStartDate);
      if (reportEndDate) params.set("endDate", reportEndDate);
    } else if (reportAnchorDate) {
      params.set("anchorDate", reportAnchorDate);
    }
    return params.toString();
  }

  async function previewReport(task?: any) {
    const taskId = task?.id as string | undefined;
    setReportLoading(true);
    const query = buildReportQuery(taskId);
    const res = await fetch(`/api/laundry/invoice/preview?${query}`);
    const body = await res.json().catch(() => ({}));
    setReportLoading(false);
    if (!res.ok) {
      toast({ title: "Preview failed", description: body.error ?? "Could not load report preview.", variant: "destructive" });
      return;
    }
    setReportTargetTask(task ?? null);
    setReportPreview(body?.data ?? null);
    setReportPreviewOpen(true);
    fetchReportHistory();
  }

  async function downloadReport(task?: any) {
    const taskId = task?.id as string | undefined;
    setReportDownloading(true);
    const res = await fetch("/api/laundry/invoice/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        taskId
          ? { taskId }
          : reportPeriod === "custom"
            ? { period: reportPeriod, startDate: reportStartDate || undefined, endDate: reportEndDate || undefined }
            : { period: reportPeriod, anchorDate: reportAnchorDate || undefined }
      ),
    });
    setReportDownloading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Download failed", description: body.error ?? "Could not generate PDF.", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = taskId ? `laundry-job-${taskId}.pdf` : `laundry-report-${reportPeriod}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    fetchReportHistory();
  }

  async function emailReport(task?: any) {
    if (!reportEmail.trim()) {
      toast({ title: "Email required", description: "Enter the recipient email first.", variant: "destructive" });
      return;
    }
    const taskId = task?.id as string | undefined;
    setReportEmailing(true);
    const res = await fetch("/api/admin/laundry/reports/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        taskId
          ? { to: reportEmail.trim(), taskId }
          : reportPeriod === "custom"
            ? { to: reportEmail.trim(), period: reportPeriod, startDate: reportStartDate || undefined, endDate: reportEndDate || undefined }
            : { to: reportEmail.trim(), period: reportPeriod, anchorDate: reportAnchorDate || undefined }
      ),
    });
    const body = await res.json().catch(() => ({}));
    setReportEmailing(false);
    if (!res.ok) {
      toast({ title: "Email failed", description: body.error ?? "Could not email report.", variant: "destructive" });
      return;
    }
    toast({ title: "Laundry report emailed" });
    fetchReportHistory();
  }

  async function replaceConfirmationPhoto(confirmationId: string, file: File) {
    setReplacingConfirmationId(confirmationId);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "laundry-confirmations");
      const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const uploadBody = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadBody?.key) {
        throw new Error(uploadBody.error ?? "Could not upload replacement photo.");
      }

      const res = await fetch(`/api/admin/laundry/confirmations/${confirmationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3Key: uploadBody.key,
          photoUrl: uploadBody.url,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not replace confirmation photo.");
      }

      toast({ title: "Confirmation photo updated" });
      fetchTasks();
    } catch (error: any) {
      toast({ title: "Photo replace failed", description: error?.message ?? "Could not replace photo.", variant: "destructive" });
    } finally {
      setReplacingConfirmationId(null);
    }
  }

  useEffect(() => {
    fetchTasks();
    fetchReportHistory();
    fetchClients();
    fetchProperties();
    fetchPendingSyncDraft();
  }, [weekStart]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ADMIN_LAUNDRY_TAB_KEY);
      if (saved === "active" || saved === "completed") {
        setActiveScheduleTab(saved);
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_LAUNDRY_TAB_KEY, activeScheduleTab);
    } catch {
      // Ignore storage failures.
    }
  }, [activeScheduleTab]);

  function handleRecipientChange(value: string) {
    setReportRecipientMode(value);
    if (value === "CUSTOM") {
      setReportEmail("");
      return;
    }
    const client = clients.find((row) => row.id === value);
    setReportEmail(client?.email?.trim() || "");
  }

  useEffect(() => {
    if (!editTask) return;
    setEditForm({
      pickupDate: dateInputValue(editTask.pickupDate),
      dropoffDate: dateInputValue(editTask.dropoffDate),
      status: editTask.status ?? "PENDING",
      flagNotes: editTask.flagNotes ?? "",
      skipReasonCode: editTask.skipReasonCode ?? "NONE",
      skipReasonNote: editTask.skipReasonNote ?? "",
      adminOverrideNote: editTask.adminOverrideNote ?? "",
    });
  }, [editTask]);

  async function generatePlan() {
    setGenerating(true);
    const res = await fetch("/api/admin/laundry/generate-week", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart: weekStart.toISOString() }),
    });
    setGenerating(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Generation failed", description: err.error ?? "Could not generate plan.", variant: "destructive" });
      return;
    }
    const body = await res.json().catch(() => ({}));
    const draft = Array.isArray(body?.draft) ? body.draft : [];
    setDraftSource("MANUAL");
    setDraftPlan(draft);
    if (draft.length === 0) {
      toast({ title: "No new plan items", description: "There are no new turnover jobs to schedule for this week." });
      return;
    }
    setDraftOpen(true);
    toast({ title: "Draft plan ready", description: "Review and approve it before it goes live." });
  }

  async function approvePlan() {
    if (draftPlan.length === 0) {
      toast({ title: "Nothing to approve", description: "The draft plan is empty.", variant: "destructive" });
      return;
    }

    setApprovingPlan(true);
    const res = await fetch("/api/admin/laundry/generate-week", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekStart: weekStart.toISOString(),
        approve: true,
        items: draftPlan,
        clearPendingSyncDraft: draftSource === "SYNC_PENDING",
        notifyLaundryAfterApproval: draftSource === "SYNC_PENDING",
      }),
    });
    const body = await res.json().catch(() => ({}));
    setApprovingPlan(false);

    if (!res.ok) {
      toast({ title: "Approval failed", description: body.error ?? "Could not approve the plan.", variant: "destructive" });
      return;
    }

    setDraftOpen(false);
    setDraftPlan([]);
    setDraftSource("MANUAL");
    toast({
      title: draftSource === "SYNC_PENDING" ? "Laundry reschedule approved" : "Laundry plan approved",
      description: `${body.appliedCount ?? draftPlan.length} task${(body.appliedCount ?? draftPlan.length) === 1 ? "" : "s"} added to the calendar.`,
    });
    fetchTasks();
    fetchPendingSyncDraft();
  }

  function reviewPendingSyncDraft() {
    if (!pendingSyncDraft || pendingSyncDraft.itemCount === 0) {
      toast({ title: "No pending sync draft", description: "There are no saved schedule changes to review." });
      return;
    }
    setDraftSource("SYNC_PENDING");
    setDraftPlan(pendingSyncDraft.items);
    setDraftOpen(true);
  }

  async function saveTaskChanges() {
    if (!editTask) return;
    if (!editForm.pickupDate || !editForm.dropoffDate) {
      toast({ title: "Pickup and drop-off dates are required.", variant: "destructive" });
      return;
    }

    setSavingTask(true);
    const pickupDate = toDateOnlyIso(editForm.pickupDate);
    const dropoffDate = toDateOnlyIso(editForm.dropoffDate);
    if (!pickupDate || !dropoffDate) {
      toast({ title: "Invalid dates selected.", variant: "destructive" });
      return;
    }
    if (editForm.status === "SKIPPED_PICKUP" && editForm.skipReasonCode === "NONE") {
      toast({ title: "Skip reason is required.", description: "Select why this pickup is being skipped.", variant: "destructive" });
      setSavingTask(false);
      return;
    }
    const res = await fetch(`/api/admin/laundry/${editTask.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pickupDate,
        dropoffDate,
        status: editForm.status,
        flagNotes: editForm.flagNotes || null,
        skipReasonCode: editForm.status === "SKIPPED_PICKUP" ? (editForm.skipReasonCode === "NONE" ? null : editForm.skipReasonCode) : null,
        skipReasonNote: editForm.skipReasonNote || null,
        adminOverrideNote: editForm.adminOverrideNote || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingTask(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update task.", variant: "destructive" });
      return;
    }
    toast({ title: "Laundry task updated" });
    setEditTask(null);
    fetchTasks();
  }

  async function deleteTask(credentials?: { pin?: string; password?: string }) {
    if (!taskToDelete) return;
    setDeletingTask(true);
    const res = await fetch(`/api/admin/laundry/${taskToDelete.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ security: credentials }),
    });
    const body = await res.json().catch(() => ({}));
    setDeletingTask(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete task.", variant: "destructive" });
      return;
    }
    toast({ title: "Laundry task deleted" });
    setTaskToDelete(null);
    fetchTasks();
  }

  async function updateFailedPickupRequest(taskId: string, action: "APPROVE_FAILED_PICKUP_SKIP" | "APPROVE_FAILED_PICKUP_DELETE" | "REJECT_FAILED_PICKUP_REQUEST") {
    setApprovingFailedPickupTaskId(taskId);
    const res = await fetch(`/api/admin/laundry/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => ({}));
    setApprovingFailedPickupTaskId(null);
    if (!res.ok) {
      toast({ title: "Approval update failed", description: body.error ?? "Could not update failed pickup request.", variant: "destructive" });
      return;
    }
    toast({
      title:
        action === "APPROVE_FAILED_PICKUP_SKIP"
          ? "Pickup skip approved"
          : action === "APPROVE_FAILED_PICKUP_DELETE"
            ? "Pickup deletion approved"
            : "Pickup request rejected",
    });
    fetchTasks();
  }

  const filteredTasks = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter !== "ALL" && task.status !== statusFilter) return false;
      if (propertyFilter !== "ALL" && task?.property?.id !== propertyFilter) return false;
      if (clientFilter !== "ALL" && task?.property?.client?.id !== clientFilter) return false;
      if (!needle) return true;
      const searchable = [
        task?.property?.name,
        task?.property?.suburb,
        task?.property?.client?.name,
        task?.property?.client?.email,
        task?.flagNotes,
        task?.skipReasonNote,
        task?.adminOverrideNote,
        task?.skipReasonCode,
        task?.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(needle);
    });
  }, [clientFilter, propertyFilter, searchQuery, statusFilter, tasks]);

  const filteredAlerts = useMemo(() => {
    const filteredIds = new Set(filteredTasks.map((task) => task.id));
    return alerts.filter((alert) => filteredIds.has(alert.id));
  }, [alerts, filteredTasks]);

  const activeTasks = useMemo(() => {
    const today = new Date();
    const todayKey = format(today, "yyyy-MM-dd");
    return [...filteredTasks]
      .filter((task) => task.status !== "DROPPED")
      .sort((left, right) => {
        const leftPickupKey = format(new Date(left.pickupDate), "yyyy-MM-dd");
        const rightPickupKey = format(new Date(right.pickupDate), "yyyy-MM-dd");
        const leftDropoffKey = format(new Date(left.dropoffDate), "yyyy-MM-dd");
        const rightDropoffKey = format(new Date(right.dropoffDate), "yyyy-MM-dd");

        const bucketFor = (pickupKey: string, dropoffKey: string) => {
          if (pickupKey === todayKey || dropoffKey === todayKey) return 0;
          if (pickupKey > todayKey || dropoffKey > todayKey) return 1;
          return 2;
        };

        const bucketDiff = bucketFor(leftPickupKey, leftDropoffKey) - bucketFor(rightPickupKey, rightDropoffKey);
        if (bucketDiff !== 0) return bucketDiff;

        const pickupDiff = new Date(left.pickupDate).getTime() - new Date(right.pickupDate).getTime();
        if (pickupDiff !== 0) return pickupDiff;

        return new Date(left.dropoffDate).getTime() - new Date(right.dropoffDate).getTime();
      });
  }, [filteredTasks]);

  const completedTasks = useMemo(
    () =>
      [...filteredTasks]
        .filter((task) => task.status === "DROPPED")
        .sort(
          (left, right) =>
            new Date(right.droppedAt ?? right.updatedAt ?? right.dropoffDate).getTime() -
            new Date(left.droppedAt ?? left.updatedAt ?? left.dropoffDate).getTime()
        ),
    [filteredTasks]
  );

  const confirmedTasks = activeTasks.filter((task) => task.status === "CONFIRMED" || task.status === "PICKED_UP");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Laundry Planner</h2>
          <p className="text-sm text-muted-foreground">
            Week of {format(weekStart, "d MMM")} - {format(addDays(weekStart, 6), "d MMM yyyy")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            {"<- Prev"}
          </Button>
          <Button variant="outline" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            {"Next ->"}
          </Button>
          <Button onClick={generatePlan} disabled={generating}>
            <RefreshCw className={`mr-2 h-4 w-4 ${generating ? "animate-spin" : ""}`} />
            Generate Draft
          </Button>
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Task
          </Button>
        </div>
      </div>

        {filteredAlerts.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {filteredAlerts.length} flagged laundry task{filteredAlerts.length > 1 ? "s" : ""} needing attention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredAlerts.map((alert) => (
                <div key={alert.id} className="rounded-md border bg-background p-3 text-sm">
                {(() => {
                  const pendingFailedPickup = getPendingFailedPickupRequest(alert);
                  const requestedAction = String(pendingFailedPickup?.requestedAction ?? "");
                  const actionLoading = approvingFailedPickupTaskId === alert.id;
                  return (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {alert.property.name} - {alert.property.suburb}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Clean: {format(new Date(alert.job.scheduledDate), "dd MMM")} | Pickup:{" "}
                            {format(new Date(alert.pickupDate), "dd MMM")} | Drop: {format(new Date(alert.dropoffDate), "dd MMM")}
                          </p>
                          {pendingFailedPickup?.reason ? (
                            <p className="mt-1 text-xs text-destructive">
                              Failed pickup: {pendingFailedPickup.reason}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant="destructive" className="shrink-0">
                          {pendingFailedPickup
                            ? `Awaiting ${requestedAction.toLowerCase()} approval`
                            : FLAG_LABELS[alert.flagReason] ?? alert.flagReason}
                        </Badge>
                      </div>
                      {pendingFailedPickup ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {requestedAction === "SKIP" ? (
                            <Button
                              size="sm"
                              onClick={() => updateFailedPickupRequest(alert.id, "APPROVE_FAILED_PICKUP_SKIP")}
                              disabled={actionLoading}
                            >
                              {actionLoading ? "Saving..." : "Approve skip"}
                            </Button>
                          ) : null}
                          {requestedAction === "DELETE" ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => updateFailedPickupRequest(alert.id, "APPROVE_FAILED_PICKUP_DELETE")}
                              disabled={actionLoading}
                            >
                              {actionLoading ? "Saving..." : "Approve delete"}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateFailedPickupRequest(alert.id, "REJECT_FAILED_PICKUP_REQUEST")}
                            disabled={actionLoading}
                          >
                            Reject request
                          </Button>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ))}
          </CardContent>
        </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filter Laundry Tasks</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5 xl:col-span-2">
              <Label>Search</Label>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Property, suburb, client, notes, skip reason"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {Object.keys(STATUS_COLORS).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Property</Label>
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All properties</SelectItem>
                  {propertyOptions.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All clients</SelectItem>
                  {clientOptions.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 xl:col-span-5 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <span>
                Showing {filteredTasks.length} of {tasks.length} task{tasks.length === 1 ? "" : "s"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("ALL");
                  setPropertyFilter("ALL");
                  setClientFilter("ALL");
                }}
              >
                Clear filters
              </Button>
            </div>
          </CardContent>
        </Card>

      {pendingSyncDraft && pendingSyncDraft.itemCount > 0 ? (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-950">
              <AlertTriangle className="h-4 w-4" />
              Laundry reschedule draft pending approval
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-amber-950/90">
              iCal sync created {pendingSyncDraft.itemCount} proposed laundry schedule change
              {pendingSyncDraft.itemCount === 1 ? "" : "s"} across {pendingSyncDraft.propertyCount} propert
              {pendingSyncDraft.propertyCount === 1 ? "y" : "ies"} from today onward. Existing completed laundry tasks were left untouched.
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-amber-900/80">
              <span>{pendingSyncDraft.createCount} new</span>
              <span>{pendingSyncDraft.updateCount} updated</span>
              {pendingSyncDraft.updatedAt ? (
                <span>Saved {format(new Date(pendingSyncDraft.updatedAt), "dd MMM yyyy HH:mm")}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reviewPendingSyncDraft}>
                Review draft
              </Button>
              <Button variant="ghost" onClick={fetchPendingSyncDraft}>
                Refresh status
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Laundry Reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Report period</Label>
              <Select value={reportPeriod} onValueChange={(value: any) => setReportPeriod(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reportPeriod === "custom" ? (
              <>
                <div className="space-y-1.5">
                  <Label>From</Label>
                  <Input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>To</Label>
                  <Input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>Anchor date</Label>
                <Input type="date" value={reportAnchorDate} onChange={(e) => setReportAnchorDate(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Email report to</Label>
              <Select value={reportRecipientMode} onValueChange={handleRecipientChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select recipient" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUSTOM">Custom email</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} ({client.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {reportRecipientMode === "CUSTOM" && (
            <div className="max-w-md space-y-1.5">
              <Label>Custom email</Label>
              <Input
                type="email"
                value={reportEmail}
                onChange={(e) => setReportEmail(e.target.value)}
                placeholder="ops@sneekproservices.com.au"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => previewReport()} disabled={reportLoading}>
              {reportLoading ? "Loading..." : "Preview"}
            </Button>
            <Button variant="outline" onClick={() => downloadReport()} disabled={reportDownloading}>
              <Download className="mr-2 h-4 w-4" />
              {reportDownloading ? "Generating..." : "Download PDF"}
            </Button>
            <Button onClick={() => emailReport()} disabled={reportEmailing}>
              <Mail className="mr-2 h-4 w-4" />
              {reportEmailing ? "Sending..." : "Email PDF"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Create laundry reports per job from the task cards below, or batch preview all scheduled and returned jobs by day, week, month, or year. PDF and email exports use the selected report scope. Current schedule view includes {propertyOptions.length} tracked propert{propertyOptions.length === 1 ? "y" : "ies"}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Saved Report History</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {reportHistory.length} saved entr{reportHistory.length === 1 ? "y" : "ies"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchReportHistory} disabled={historyLoading}>
              {historyLoading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReportHistoryOpen((prev) => !prev)}>
              {reportHistoryOpen ? (
                <>
                  <ChevronUp className="mr-1 h-4 w-4" />
                  Hide
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-4 w-4" />
                  Show
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {reportHistoryOpen ? (
          <CardContent>
            {reportHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No laundry reports have been logged yet.
            </p>
            ) : (
              <div className="space-y-2">
                {reportHistory.map((entry) => {
                  const details = entry?.details && typeof entry.details === "object" ? entry.details : {};
                  const actionLabel = String(entry.action ?? "")
                    .replace(/^LAUNDRY_REPORT_/, "")
                    .replace(/_/g, " ");
                  const modeLabel = details?.mode === "single_task" ? "Single task" : "Batch";
                  const recipient = typeof details?.recipient === "string" ? details.recipient : "";
                  return (
                    <div key={entry.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {actionLabel} - {modeLabel}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(entry.createdAt), "dd MMM yyyy HH:mm")} by{" "}
                            {entry.user?.name || entry.user?.email || "Unknown user"}
                            {entry.user?.role ? ` (${entry.user.role})` : ""}
                          </p>
                        </div>
                        <Badge variant={actionLabel === "EMAIL" ? "success" : "secondary"}>
                          {actionLabel}
                        </Badge>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-4">
                        <div className="rounded-md bg-muted/40 p-2">
                          <p className="text-xs text-muted-foreground">Scope</p>
                          <p>
                            {details?.period ? String(details.period).replace(/_/g, " ") : "Custom"}{" "}
                            {details?.propertyName ? `- ${details.propertyName}` : ""}
                          </p>
                        </div>
                        <div className="rounded-md bg-muted/40 p-2">
                          <p className="text-xs text-muted-foreground">Range</p>
                          <p>
                            {details?.startDate ? format(new Date(details.startDate), "dd MMM yyyy") : "-"} {"->"}{" "}
                            {details?.endDate ? format(new Date(details.endDate), "dd MMM yyyy") : "-"}
                          </p>
                        </div>
                        <div className="rounded-md bg-muted/40 p-2">
                          <p className="text-xs text-muted-foreground">Rows / Total</p>
                          <p>
                            {Number(details?.rowCount ?? 0)} row(s) | ${Number(details?.totalAmount ?? 0).toFixed(2)}
                          </p>
                        </div>
                        <div className="rounded-md bg-muted/40 p-2">
                          <p className="text-xs text-muted-foreground">Recipient</p>
                          <p>{recipient || "-"}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ready Queue (Cleaner Confirmed)</CardTitle>
        </CardHeader>
        <CardContent>
          {confirmedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tasks.length === 0 ? "No confirmed pickups this week." : "No confirmed pickups matched the current filters."}
            </p>
          ) : (
            <div className="space-y-2">
              {confirmedTasks.map((task) => (
                <div key={task.id} className="rounded-md border p-3 text-sm">
                  {(() => {
                    const cleanerConfirmation = getCleanerLaundryConfirmation(task);
                    const pickupConfirmation = getEventConfirmation(task, "PICKED_UP");
                    const droppedConfirmation = getEventConfirmation(task, "DROPPED");
                    const mediaItems = [
                      cleanerConfirmation?.photoUrl
                        ? {
                            id: `${task.id}-cleaner`,
                            confirmationId: cleanerConfirmation.id,
                            url: cleanerConfirmation.photoUrl,
                            label: "Cleaner proof",
                            mediaType: "PHOTO",
                          }
                        : null,
                      pickupConfirmation?.photoUrl
                        ? {
                            id: `${task.id}-pickup`,
                            confirmationId: pickupConfirmation.id,
                            url: pickupConfirmation.photoUrl,
                            label: "Pickup proof",
                            mediaType: "PHOTO",
                          }
                        : null,
                      droppedConfirmation?.photoUrl
                        ? {
                            id: `${task.id}-dropoff`,
                            confirmationId: droppedConfirmation.id,
                            url: droppedConfirmation.photoUrl,
                            label: "Drop-off proof",
                            mediaType: "PHOTO",
                          }
                        : null,
                    ].filter(Boolean) as any[];
                    return (
                      <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {task.property.name} - {task.property.suburb}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Pickup: {format(new Date(task.pickupDate), "dd MMM")} | Drop-off:{" "}
                        {format(new Date(task.dropoffDate), "dd MMM")}
                      </p>
                    </div>
                    <Badge variant={STATUS_COLORS[task.status] as any}>{task.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => previewReport(task)}>
                      Preview report
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadReport(task)}>
                      Task PDF
                    </Button>
                    <Button size="sm" onClick={() => emailReport(task)}>
                      Email PDF
                    </Button>
                  </div>
                  {mediaItems.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Evidence</p>
                      <MediaGallery items={mediaItems} title="Laundry Evidence" className="grid grid-cols-3 gap-2" />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {mediaItems.map((item: any) => (
                          <label key={`${item.id}-replace`} className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file && item.confirmationId) {
                                  void replaceConfirmationPhoto(item.confirmationId, file);
                                }
                                event.currentTarget.value = "";
                              }}
                            />
                            {replacingConfirmationId === item.confirmationId ? `Replacing ${item.label}...` : `Replace ${item.label}`}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 rounded-md bg-muted/40 p-2">
                    <p className="mb-1 text-xs font-medium">Timeline</p>
                    <div className="space-y-1">
                      {buildTimeline(task).map((event, index) => (
                        <p key={index} className="text-xs text-muted-foreground">
                          {format(event.at, "dd MMM HH:mm")} - {event.label}
                        </p>
                      ))}
                    </div>
                  </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Laundry Schedule</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{activeTasks.length} active</span>
              <span>•</span>
              <span>{completedTasks.length} completed</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeScheduleTab} onValueChange={(value) => setActiveScheduleTab(value as "active" | "completed")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="active">Today & upcoming</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>
            <TabsContent value="active" className="mt-4">
              <div className="px-0 pb-0">
                {activeTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {tasks.length === 0 ? "No laundry tasks this week. Generate plan first." : "No active laundry tasks matched the current filters."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {activeTasks.map((task) => (
                      <div key={task.id} className="rounded-md border p-3 text-sm">
                        {(() => {
                          const cleanerConfirmation = getCleanerLaundryConfirmation(task);
                          const pickupConfirmation = getEventConfirmation(task, "PICKED_UP");
                          const droppedConfirmation = getEventConfirmation(task, "DROPPED");
                          const mediaItems = [
                            cleanerConfirmation?.photoUrl
                              ? {
                                  id: `${task.id}-cleaner`,
                                  confirmationId: cleanerConfirmation.id,
                                  url: cleanerConfirmation.photoUrl,
                                  label: "Cleaner proof",
                                  mediaType: "PHOTO",
                                }
                              : null,
                            pickupConfirmation?.photoUrl
                              ? {
                                  id: `${task.id}-pickup`,
                                  confirmationId: pickupConfirmation.id,
                                  url: pickupConfirmation.photoUrl,
                                  label: "Pickup proof",
                                  mediaType: "PHOTO",
                                }
                              : null,
                            droppedConfirmation?.photoUrl
                              ? {
                                  id: `${task.id}-dropoff`,
                                  confirmationId: droppedConfirmation.id,
                                  url: droppedConfirmation.photoUrl,
                                  label: "Drop-off proof",
                                  mediaType: "PHOTO",
                                }
                              : null,
                          ].filter(Boolean) as any[];
                          return (
                            <>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="flex items-center gap-2 font-medium">
                                    <Shirt className="h-3 w-3" />
                                    {task.property.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Pickup {format(new Date(task.pickupDate), "EEE dd MMM")} {"->"} Drop{" "}
                                    {format(new Date(task.dropoffDate), "EEE dd MMM")}
                                    {task.property.linenBufferSets > 0 && ` | ${task.property.linenBufferSets} buffer sets`}
                                  </p>
                                  {task.flagNotes ? <p className="mt-0.5 text-xs text-destructive">{task.flagNotes}</p> : null}
                                  {task.status === "SKIPPED_PICKUP" ? (
                                    <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                                      <p>
                                        Skip reason:{" "}
                                        {LAUNDRY_SKIP_REASONS.find((reason) => reason.value === task.skipReasonCode)?.label ??
                                          String(task.skipReasonCode ?? "Not set").replace(/_/g, " ")}
                                      </p>
                                      {task.skipReasonNote ? <p className="mt-1 text-amber-800">Cleaner note: {task.skipReasonNote}</p> : null}
                                      {task.adminOverrideNote ? <p className="mt-1 text-amber-800">Admin note: {task.adminOverrideNote}</p> : null}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={STATUS_COLORS[task.status] as any}>{task.status.replace(/_/g, " ")}</Badge>
                                  <Button size="icon" variant="ghost" onClick={() => setEditTask(task)} aria-label="Edit task">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setTaskToDelete(task)}
                                    aria-label="Delete task"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" onClick={() => previewReport(task)}>
                                  Preview report
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => downloadReport(task)}>
                                  Task PDF
                                </Button>
                                <Button size="sm" onClick={() => emailReport(task)}>
                                  Email PDF
                                </Button>
                              </div>
                              {mediaItems.length > 0 ? (
                                <div className="mt-2">
                                  <p className="mb-1 text-xs font-medium text-muted-foreground">Evidence</p>
                                  <MediaGallery items={mediaItems} title="Laundry Evidence" className="grid grid-cols-3 gap-2" />
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {mediaItems.map((item: any) => (
                                      <label key={`${item.id}-replace`} className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs">
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file && item.confirmationId) {
                                              void replaceConfirmationPhoto(item.confirmationId, file);
                                            }
                                            event.currentTarget.value = "";
                                          }}
                                        />
                                        {replacingConfirmationId === item.confirmationId ? `Replacing ${item.label}...` : `Replace ${item.label}`}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              <div className="mt-2 rounded-md bg-muted/40 p-2">
                                <p className="mb-1 text-xs font-medium">Timeline</p>
                                <div className="space-y-1">
                                  {buildTimeline(task).map((event, index) => (
                                    <p key={index} className="text-xs text-muted-foreground">
                                      {format(event.at, "dd MMM HH:mm")} - {event.label}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="completed" className="mt-4">
              <div className="px-0 pb-0">
                {completedTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No completed laundry tasks matched the current filters.</p>
                ) : (
                  <div className="space-y-2">
                    {completedTasks.map((task) => {
                      const cleanerConfirmation = getCleanerLaundryConfirmation(task);
                      const pickupConfirmation = getEventConfirmation(task, "PICKED_UP");
                      const droppedConfirmation = getEventConfirmation(task, "DROPPED");
                      const mediaItems = [
                        cleanerConfirmation?.photoUrl
                          ? {
                              id: `${task.id}-cleaner`,
                              url: cleanerConfirmation.photoUrl,
                              label: "Cleaner proof",
                              mediaType: "PHOTO",
                            }
                          : null,
                        pickupConfirmation?.photoUrl
                          ? {
                              id: `${task.id}-pickup`,
                              url: pickupConfirmation.photoUrl,
                              label: "Pickup proof",
                              mediaType: "PHOTO",
                            }
                          : null,
                        droppedConfirmation?.photoUrl
                          ? {
                              id: `${task.id}-dropoff`,
                              url: droppedConfirmation.photoUrl,
                              label: "Drop-off proof",
                              mediaType: "PHOTO",
                            }
                          : null,
                      ].filter(Boolean) as any[];

                      return (
                        <div key={task.id} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">{task.property.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Completed {format(new Date(task.droppedAt ?? task.dropoffDate), "dd MMM yyyy")} • Pickup {format(new Date(task.pickupDate), "dd MMM")} • Drop {format(new Date(task.dropoffDate), "dd MMM")}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="success">Completed</Badge>
                              <Button size="icon" variant="ghost" onClick={() => setEditTask(task)} aria-label="Edit completed task">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          {mediaItems.length > 0 ? (
                            <div className="mt-3">
                              <p className="mb-1 text-xs font-medium text-muted-foreground">Evidence</p>
                              <MediaGallery items={mediaItems} title="Laundry Evidence" className="grid grid-cols-3 gap-2" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editTask)} onOpenChange={(open) => !open && setEditTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit laundry task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Pickup date</Label>
              <Input
                type="date"
                value={editForm.pickupDate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, pickupDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Drop-off date</Label>
              <Input
                type="date"
                value={editForm.dropoffDate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, dropoffDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(STATUS_COLORS).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Flag notes</Label>
              <Textarea
                value={editForm.flagNotes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, flagNotes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>
            {editForm.status === "SKIPPED_PICKUP" ? (
              <>
                <div className="space-y-1.5">
                  <Label>Skip reason</Label>
                  <Select
                    value={editForm.skipReasonCode}
                    onValueChange={(value) => setEditForm((prev) => ({ ...prev, skipReasonCode: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {LAUNDRY_SKIP_REASONS.map((reason) => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cleaner note</Label>
                  <Textarea
                    value={editForm.skipReasonNote}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, skipReasonNote: e.target.value }))}
                    placeholder="Optional cleaner or operational note"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Admin override note</Label>
                  <Textarea
                    value={editForm.adminOverrideNote}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, adminOverrideNote: e.target.value }))}
                    placeholder="Shown to the laundry team when admin needs to clarify the skip"
                  />
                </div>
              </>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditTask(null)} disabled={savingTask}>
                Cancel
              </Button>
              <Button onClick={saveTaskChanges} disabled={savingTask}>
                {savingTask ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reportPreviewOpen} onOpenChange={(open) => !open && setReportPreviewOpen(false)}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {reportTargetTask ? "Laundry Job Report Preview" : "Laundry Batch Report Preview"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {reportPreview ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Period</p>
                    <p className="font-medium">{reportPreview.period}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Rows</p>
                    <p className="font-medium">{reportPreview.rows?.length ?? 0}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Properties</p>
                    <p className="font-medium">{reportPreview.propertyBreakdown?.length ?? 0}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="font-medium">${Number(reportPreview.totalAmount ?? 0).toFixed(2)}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {(reportPreview.rows ?? []).map((row: any) => {
                    const mediaItems = [
                      row.cleanerPhotoUrl ? { id: `${row.taskId}-cleaner`, url: row.cleanerPhotoUrl, label: "Cleaner", mediaType: "PHOTO" } : null,
                      row.pickupPhotoUrl ? { id: `${row.taskId}-pickup`, url: row.pickupPhotoUrl, label: "Pickup", mediaType: "PHOTO" } : null,
                      row.dropoffPhotoUrl ? { id: `${row.taskId}-dropoff`, url: row.dropoffPhotoUrl, label: "Drop-off", mediaType: "PHOTO" } : null,
                    ].filter(Boolean) as any[];

                    return (
                      <div key={row.taskId} className="rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{row.propertyName}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.suburb} | Service {format(new Date(row.serviceDate), "dd MMM yyyy")} | Pickup {format(new Date(row.pickupDate), "dd MMM yyyy")} | Drop {format(new Date(row.dropoffDate), "dd MMM yyyy")}
                            </p>
                          </div>
                          <Badge variant={STATUS_COLORS[row.status] as any}>{String(row.status).replace(/_/g, " ")}</Badge>
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <div className="rounded-md bg-muted/40 p-2">
                            <p className="text-xs text-muted-foreground">Bags / Amount</p>
                            <p>{row.bagCount ?? "-"} bag(s) | ${Number(row.amount ?? 0).toFixed(2)}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-2">
                            <p className="text-xs text-muted-foreground">Drop-off location</p>
                            <p>{row.dropoffLocation || "-"}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-2">
                            <p className="text-xs text-muted-foreground">Notes</p>
                            <p>{row.notes || row.earlyDropoffReason || "-"}</p>
                          </div>
                        </div>
                        {mediaItems.length > 0 && (
                          <div className="mt-3">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Evidence</p>
                            <MediaGallery items={mediaItems} title="Laundry Report Evidence" className="grid grid-cols-3 gap-2" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No preview loaded.</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReportPreviewOpen(false)}>
              Close
            </Button>
            <Button variant="outline" onClick={() => downloadReport(reportTargetTask)} disabled={reportDownloading}>
              {reportDownloading ? "Generating..." : "Download PDF"}
            </Button>
            <Button onClick={() => emailReport(reportTargetTask)} disabled={reportEmailing}>
              {reportEmailing ? "Sending..." : "Email PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={draftOpen} onOpenChange={(open) => !open && setDraftOpen(false)}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{draftSource === "SYNC_PENDING" ? "Review iCal Laundry Reschedule" : "Review Laundry Plan"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{draftSource === "SYNC_PENDING" ? "The sync-driven schedule changes are still a draft." : "The plan is still a draft."}</p>
              <p className="mt-1 text-muted-foreground">
                {draftSource === "SYNC_PENDING"
                  ? "It will not change the live laundry calendar until you approve it. Approval applies the new dates and then notifies the relevant laundry team."
                  : "It will not appear in the live calendar until you approve it. Laundry-ready notifications still wait for the cleaner to submit and confirm bag placement."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Rule summary: pickup is always the day after the clean date, never on the same day as cleaning. If a next clean date is known, drop-off is set to the day before that clean (or earliest valid 24h drop when the gap is tight). If no next clean is known yet, the batch is returned quickly (next day) so linen is ready for late bookings.
              </p>
            </div>

            {draftPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground">No draft items in this plan.</p>
            ) : (
              <div className="space-y-3">
                {draftPlan.map((item, index) => (
                  <div key={`${item.jobId}-${index}`} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {item.propertyName} {item.suburb ? `- ${item.suburb}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Clean day {format(new Date(item.cleanDate), "EEE dd MMM yyyy")} | Scenario {item.scenario.replace(/_/g, " ")}
                          {item.linenBufferSets > 0 ? ` | ${item.linenBufferSets} buffer set${item.linenBufferSets > 1 ? "s" : ""}` : ""}
                        </p>
                        {item.operation ? (
                          <p className="mt-1 text-xs font-medium text-amber-700">
                            {item.operation === "CREATE" ? "New schedule entry" : "Existing task will be updated"}
                          </p>
                        ) : null}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeDraftItem(index)} aria-label="Remove draft item">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {item.operation === "UPDATE" ? (
                      <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                        Current: pickup {item.currentPickupDate ? format(new Date(item.currentPickupDate), "EEE dd MMM") : "-"} | drop-off{" "}
                        {item.currentDropoffDate ? format(new Date(item.currentDropoffDate), "EEE dd MMM") : "-"} | status{" "}
                        {item.currentStatus ? String(item.currentStatus).replace(/_/g, " ") : "-"}
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label>Pickup</Label>
                        <Input
                          type="date"
                          value={dateInputValue(item.pickupDate)}
                          onChange={(e) => {
                            const nextValue = toDateOnlyIso(e.target.value);
                            if (!nextValue) return;
                            updateDraftItem(index, { pickupDate: nextValue });
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Drop-off</Label>
                        <Input
                          type="date"
                          value={dateInputValue(item.dropoffDate)}
                          onChange={(e) => {
                            const nextValue = toDateOnlyIso(e.target.value);
                            if (!nextValue) return;
                            updateDraftItem(index, { dropoffDate: nextValue });
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Status</Label>
                        <Select value={item.status} onValueChange={(value) => updateDraftItem(index, { status: value })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["PENDING", "FLAGGED"].map((status) => (
                              <SelectItem key={status} value={status}>
                                {status.replace(/_/g, " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Flag reason</Label>
                        <Select
                          value={item.flagReason ?? "NONE"}
                          onValueChange={(value) =>
                            updateDraftItem(index, { flagReason: value === "NONE" ? null : value, status: value === "NONE" ? "PENDING" : "FLAGGED" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">None</SelectItem>
                            {Object.keys(FLAG_LABELS).map((flag) => (
                              <SelectItem key={flag} value={flag}>
                                {FLAG_LABELS[flag]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <Label>Planner notes</Label>
                      <Textarea
                        value={item.flagNotes ?? ""}
                        onChange={(e) => updateDraftItem(index, { flagNotes: e.target.value || null })}
                        placeholder="Optional explanation for the laundry team"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraftOpen(false)} disabled={approvingPlan}>
                Close
              </Button>
              <Button onClick={approvePlan} disabled={approvingPlan || draftPlan.length === 0}>
                <Check className="mr-2 h-4 w-4" />
                {approvingPlan ? "Approving..." : "Approve Plan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open && !creatingTask) setCreateOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Laundry Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Property</Label>
              <Select value={createForm.propertyId} onValueChange={(v) => { setCreateForm((f) => ({ ...f, propertyId: v, jobId: "" })); fetchPropertyJobs(v); }} disabled={creatingTask}>
                <SelectTrigger><SelectValue placeholder="Select a property" /></SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — {p.suburb}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Job</Label>
              <Select value={createForm.jobId} onValueChange={(v) => setCreateForm((f) => ({ ...f, jobId: v }))} disabled={creatingTask || propertyJobs.length === 0}>
                <SelectTrigger><SelectValue placeholder={propertyJobs.length === 0 ? "No active jobs for this property" : "Select a job"} /></SelectTrigger>
                <SelectContent>
                  {propertyJobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>{j.jobNumber} — {j.jobType.replace(/_/g, " ")} ({new Date(j.scheduledDate).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Pickup date</Label>
                <Input type="date" value={createForm.pickupDate} onChange={(e) => setCreateForm((f) => ({ ...f, pickupDate: e.target.value }))} disabled={creatingTask} />
              </div>
              <div className="space-y-1.5">
                <Label>Drop-off date</Label>
                <Input type="date" value={createForm.dropoffDate} onChange={(e) => setCreateForm((f) => ({ ...f, dropoffDate: e.target.value }))} disabled={creatingTask} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Flag notes (optional)</Label>
              <Textarea rows={2} value={createForm.flagNotes} onChange={(e) => setCreateForm((f) => ({ ...f, flagNotes: e.target.value }))} disabled={creatingTask} placeholder="Any special instructions…" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creatingTask}>Cancel</Button>
            <Button onClick={createLaundryTask} disabled={creatingTask}>{creatingTask ? "Creating…" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={Boolean(taskToDelete)}
        onOpenChange={(open) => !open && setTaskToDelete(null)}
        title="Delete laundry task"
        description="This removes the task and linked confirmations for this job."
        actionKey="deleteLaundryTask"
        confirmLabel="Delete task"
        requireSecurityVerification
        loading={deletingTask}
        onConfirm={deleteTask}
      />
    </div>
  );
}
