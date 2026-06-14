"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { AlertTriangle, Briefcase, ChevronLeft, ChevronRight, Kanban, List, Plus, Settings2, SlidersHorizontal, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { MultiSelectDropdown } from "@/components/shared/multi-select-dropdown";
import { toast } from "@/hooks/use-toast";
import { JobRow, STATUS_COLORS, STATUS_LABELS } from "./job-row";

const TZ = "Australia/Sydney";

const JOB_STATUSES = [
  "UNASSIGNED",
  "OFFERED",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_CONTINUATION_APPROVAL",
  "SUBMITTED",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
];

// Quick status chips surfaced above the list (the old "Active/Completed" tabs
// collapse into these). "active" / "completed" are virtual groups that expand
// to a set of real JobStatus values; everything else is a single status.
type StatusChip = { id: string; label: string };
const STATUS_CHIPS: StatusChip[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "UNASSIGNED", label: "Unassigned" },
  { id: "IN_PROGRESS", label: "In Progress" },
  { id: "QA_REVIEW", label: "QA Review" },
  { id: "COMPLETED", label: "Completed" },
  { id: "INVOICED", label: "Invoiced" },
];
const COMPLETED_STATUSES = ["COMPLETED", "INVOICED"];

// Quick date chips (Australia/Sydney). These compose with the status filter.
type DateFilter = "all" | "today" | "tomorrow" | "week";
const DATE_CHIPS: { id: DateFilter; label: string }[] = [
  { id: "all", label: "All dates" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
];

function sydneyDayKey(value: string | Date): string {
  return format(toZonedTime(new Date(value), TZ), "yyyy-MM-dd");
}
function todayKey(): string {
  return format(toZonedTime(new Date(), TZ), "yyyy-MM-dd");
}
function tomorrowKey(): string {
  const base = toZonedTime(new Date(), TZ);
  return format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1), "yyyy-MM-dd");
}
function weekEndKey(): string {
  const base = toZonedTime(new Date(), TZ);
  return format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 6), "yyyy-MM-dd");
}

/** Resolve a quick date chip to the dateFrom/dateTo pair sent to /api/jobs (Sydney). */
function dateFilterRange(filter: DateFilter): { dateFrom: string; dateTo: string } {
  if (filter === "today") return { dateFrom: todayKey(), dateTo: todayKey() };
  if (filter === "tomorrow") return { dateFrom: tomorrowKey(), dateTo: tomorrowKey() };
  if (filter === "week") return { dateFrom: todayKey(), dateTo: weekEndKey() };
  return { dateFrom: "", dateTo: "" };
}

const JOB_FILTER_DEFAULTS = {
  status: "all",
  search: "",
  cleanerName: "",
  jobType: "all",
  clientId: "all",
  propertyId: "all",
  dateFilter: "all" as DateFilter,
  dateFrom: "",
  dateTo: "",
  invoiced: "all",
};

const JOB_VIEW_STORAGE_KEY = "sneek_admin_jobs_view_v1";
const JOBS_PAGE_SIZE = 50;
const KANBAN_COLUMN_PREVIEW = 12;

type JobFilters = typeof JOB_FILTER_DEFAULTS;

function parseJobFilters(params: { get(name: string): string | null }): JobFilters {
  const rawDateFilter = params.get("dateFilter");
  const dateFilter: DateFilter =
    rawDateFilter === "today" || rawDateFilter === "tomorrow" || rawDateFilter === "week"
      ? rawDateFilter
      : "all";
  return {
    status: params.get("status") || JOB_FILTER_DEFAULTS.status,
    search: params.get("search") || JOB_FILTER_DEFAULTS.search,
    cleanerName: params.get("cleanerName") || JOB_FILTER_DEFAULTS.cleanerName,
    jobType: params.get("jobType") || JOB_FILTER_DEFAULTS.jobType,
    clientId: params.get("clientId") || JOB_FILTER_DEFAULTS.clientId,
    propertyId: params.get("propertyId") || JOB_FILTER_DEFAULTS.propertyId,
    dateFilter,
    dateFrom: params.get("dateFrom") || JOB_FILTER_DEFAULTS.dateFrom,
    dateTo: params.get("dateTo") || JOB_FILTER_DEFAULTS.dateTo,
    invoiced: params.get("invoiced") || JOB_FILTER_DEFAULTS.invoiced,
  };
}

export default function JobsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: JOBS_PAGE_SIZE, totalCount: 0, totalPages: 0, hasMore: false });
  const [filters, setFilters] = useState<JobFilters>(() => parseJobFilters(searchParams));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [savedView, setSavedView] = useState<"list" | "kanban">("list");
  const [viewPreferenceDraft, setViewPreferenceDraft] = useState<"list" | "kanban">("list");
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [kanbanVisibleCounts, setKanbanVisibleCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<any | null>(null);

  const [qaScoreByJob, setQaScoreByJob] = useState<Record<string, string>>({});
  const [qaNotesByJob, setQaNotesByJob] = useState<Record<string, string>>({});
  const [qaSubmittingByJob, setQaSubmittingByJob] = useState<Record<string, boolean>>({});
  const [qaSelectedIds, setQaSelectedIds] = useState<string[]>([]);
  const [batchQaScore, setBatchQaScore] = useState("90");
  const [batchQaNotes, setBatchQaNotes] = useState("");
  const [batchQaSubmitting, setBatchQaSubmitting] = useState(false);
  const [quickAssigningByJob, setQuickAssigningByJob] = useState<Record<string, boolean>>({});
  const [cleaners, setCleaners] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [properties, setProperties] = useState<Array<{ id: string; name: string; suburb: string }>>([]);
  const [quickAssignOpen, setQuickAssignOpen] = useState(false);
  const [quickAssignJob, setQuickAssignJob] = useState<any | null>(null);
  const [quickAssignSelected, setQuickAssignSelected] = useState<string[]>([]);
  const [quickAssignSubmitting, setQuickAssignSubmitting] = useState(false);
  const [pendingContinuationRows, setPendingContinuationRows] = useState<any[]>([]);
  const [pendingTimingCount, setPendingTimingCount] = useState(0);
  const [pendingRescheduleJobIds, setPendingRescheduleJobIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkCleanerId, setBulkCleanerId] = useState("");
  const [bulkStatusValue, setBulkStatusValue] = useState("ASSIGNED");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // Build the /api/jobs query from the current filters (status chip + date chip
  // + the rest). Shared by loadJobs and the CSV export so they stay in sync.
  function buildJobsQuery(overrides?: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams({ paginated: "1" });
    // Status chip: "active"/"completed" are virtual groups; anything else is a
    // single JobStatus. "all" sends nothing so every status is returned.
    if (filters.status === "active") {
      params.set("statusGroup", "active");
    } else if (filters.status === "completed") {
      params.set("statusGroup", "completed");
    } else if (filters.status !== "all") {
      params.set("status", filters.status);
    }
    if (filters.jobType !== "all") params.set("jobType", filters.jobType);
    if (filters.clientId !== "all") params.set("clientId", filters.clientId);
    if (filters.propertyId !== "all") params.set("propertyId", filters.propertyId);

    // Quick date chip wins; fall back to the explicit date-range inputs.
    const quickRange = dateFilterRange(filters.dateFilter);
    const dateFrom = quickRange.dateFrom || filters.dateFrom;
    const dateTo = quickRange.dateTo || filters.dateTo;
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    }
    return params;
  }

  async function loadJobs(page: number = 1) {
    setLoading(true);
    const params = buildJobsQuery({ page: String(page), limit: String(JOBS_PAGE_SIZE) });
    const res = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({ jobs: [], pagination: {} }));
    setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    if (data?.pagination) {
      setPagination(data.pagination);
    }
    setLoading(false);
  }

  async function loadPendingContinuations() {
    const res = await fetch("/api/admin/job-continuations?status=PENDING", { cache: "no-store" });
    const data = await res.json().catch(() => []);
    setPendingContinuationRows(Array.isArray(data) ? data : []);
  }

  async function loadJobApprovalCounts() {
    try {
      const res = await fetch("/api/admin/all-approvals");
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (body?.counts) {
        setPendingTimingCount(body.counts.timingRequests ?? 0);
      }
      if (Array.isArray(body?.rescheduleRequests)) {
        const ids = new Set<string>(
          body.rescheduleRequests
            .map((r: any) => r.jobId)
            .filter(Boolean)
        );
        setPendingRescheduleJobIds(ids);
      }
    } catch { /* silent */ }
  }

  useEffect(() => {
    loadJobs(1);
    loadPendingContinuations();
    loadJobApprovalCounts();
  }, []);

  useEffect(() => {
    loadJobs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.jobType, filters.clientId, filters.propertyId, filters.dateFilter, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    setKanbanVisibleCounts({});
  }, [filters.status, filters.search, filters.cleanerName, filters.jobType, filters.dateFilter, filters.dateFrom, filters.dateTo, filters.invoiced]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(JOB_VIEW_STORAGE_KEY);
      if (saved === "list" || saved === "kanban") {
        setView(saved);
        setSavedView(saved);
        setViewPreferenceDraft(saved);
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      const defaultValue = JOB_FILTER_DEFAULTS[key as keyof JobFilters];
      if (value && value !== defaultValue) {
        params.set(key, value);
      }
    });
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [filters, pathname, router]);

  useEffect(() => {
    fetch("/api/admin/users?role=CLEANER")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next = Array.isArray(rows)
          ? rows
              .map((row: any) => ({
                id: String(row.id ?? ""),
                name: String(row.name ?? row.email ?? "").trim(),
                email: String(row.email ?? "").trim(),
              }))
              .filter((row) => row.id)
          : [];
        setCleaners(next);
      })
      .catch(() => {
        setCleaners([]);
      });

    fetch("/api/admin/clients")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next = Array.isArray(rows)
          ? rows.map((row: any) => ({ id: String(row.id ?? ""), name: String(row.name ?? "").trim() })).filter((row) => row.id)
          : [];
        setClients(next);
      })
      .catch(() => setClients([]));

    fetch("/api/admin/properties?limit=500")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next = Array.isArray(rows)
          ? rows.map((row: any) => ({ id: String(row.id ?? ""), name: String(row.name ?? "").trim(), suburb: String(row.suburb ?? "").trim() })).filter((row) => row.id)
          : [];
        setProperties(next);
      })
      .catch(() => setProperties([]));
  }, []);

  const cleanerOptions = useMemo(
    () =>
      cleaners.map((cleaner) => ({
        id: cleaner.id,
        label: cleaner.name || cleaner.email,
        hint: cleaner.email,
      })),
    [cleaners]
  );
  const jobTypeOptions = useMemo(
    () => Array.from(new Set(jobs.map((job) => String(job?.jobType ?? "")).filter(Boolean))).sort(),
    [jobs]
  );
  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([key, value]) => {
        const defaultValue = JOB_FILTER_DEFAULTS[key as keyof JobFilters];
        return value !== defaultValue;
      }).length,
    [filters]
  );
  // Server-side filters (status group/single status + date range + property +
  // client + job type) are already applied by /api/jobs. The client pass only
  // layers the text-based refinements (search, cleaner name) and the invoiced
  // toggle on top, so completed jobs are never silently dropped here.
  const filteredJobs = useMemo(() => {
    const searchNeedle = filters.search.trim().toLowerCase();
    const cleanerNeedle = filters.cleanerName.trim().toLowerCase();

    return jobs.filter((job) => {
      const isInvoiced =
        job.status === "INVOICED" ||
        Boolean(job.invoiceId) ||
        Boolean(job.invoice?.id) ||
        Boolean(job.clientInvoiceLineId) ||
        Boolean(job.clientInvoiceLine?.id);
      if (filters.invoiced === "yes" && !isInvoiced) return false;
      if (filters.invoiced === "no" && isInvoiced) return false;

      if (searchNeedle) {
        const searchable = [
          job.jobNumber,
          job.property?.name,
          job.property?.suburb,
          job.client?.name,
          job.client?.email,
          job.property?.client?.name,
          job.property?.client?.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(searchNeedle)) return false;
      }

      if (cleanerNeedle) {
        const assignmentText = getAssignmentNames(job).join(" ").toLowerCase();
        if (!assignmentText.includes(cleanerNeedle)) return false;
      }

      return true;
    });
  }, [filters, jobs]);
  const qaQueueJobs = useMemo(
    () => filteredJobs.filter((job) => job.status === "SUBMITTED" || job.status === "QA_REVIEW"),
    [filteredJobs]
  );
  const pendingContinuationJobIds = useMemo(
    () => new Set(pendingContinuationRows.map((row) => row.jobId).filter(Boolean)),
    [pendingContinuationRows]
  );

  useEffect(() => {
    if (qaQueueJobs.length === 0) {
      setQaSelectedIds([]);
      return;
    }
    setQaScoreByJob((prev) => {
      const next = { ...prev };
      for (const job of qaQueueJobs) {
        if (!next[job.id]) {
          const latestScore = job.qaReviews?.[0]?.score;
          next[job.id] = latestScore !== undefined && latestScore !== null ? String(Math.round(latestScore)) : "90";
        }
      }
      return next;
    });
    setQaSelectedIds((prev) => prev.filter((id) => qaQueueJobs.some((job) => job.id === id)));
  }, [qaQueueJobs]);

  useEffect(() => {
    const allowedIds = new Set(filteredJobs.map((job) => job.id));
    setSelectedIds((current) => current.filter((id) => allowedIds.has(id)));
  }, [filteredJobs]);

  function toggleQaSelection(jobId: string) {
    setQaSelectedIds((prev) => {
      if (prev.includes(jobId)) return prev.filter((id) => id !== jobId);
      return [...prev, jobId];
    });
  }

  async function submitQaReview(
    jobId: string,
    options?: { score?: string; notes?: string; suppressToast?: boolean }
  ) {
    const scoreValue = options?.score ?? qaScoreByJob[jobId] ?? "90";
    const notesValue = options?.notes ?? qaNotesByJob[jobId] ?? "";
    const score = Number(scoreValue);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      if (!options?.suppressToast) {
        toast({ title: "Score must be between 0 and 100", variant: "destructive" });
      }
      return false;
    }

    setQaSubmittingByJob((prev) => ({ ...prev, [jobId]: true }));
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, notes: notesValue.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not submit QA review.");
      }
      setQaSelectedIds((prev) => prev.filter((id) => id !== jobId));
      if (!options?.suppressToast) {
        toast({
          title: "QA review saved",
          description: `Recorded ${Math.round(score)}%${
            typeof body?.passed === "boolean" ? ` — ${body.passed ? "Passed" : "Flagged for rework"}` : ""
          }.`,
        });
      }
      return true;
    } catch (err: any) {
      if (!options?.suppressToast) {
        toast({
          title: "QA failed",
          description: err.message ?? "Could not submit QA review.",
          variant: "destructive",
        });
      }
      return false;
    } finally {
      setQaSubmittingByJob((prev) => ({ ...prev, [jobId]: false }));
    }
  }

  async function submitBatchQa() {
    if (qaSelectedIds.length === 0) {
      toast({ title: "Select at least one job", variant: "destructive" });
      return;
    }
    const score = Number(batchQaScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      toast({ title: "Batch score must be between 0 and 100", variant: "destructive" });
      return;
    }

    setBatchQaSubmitting(true);
    let successCount = 0;
    for (const jobId of qaSelectedIds) {
      const ok = await submitQaReview(jobId, {
        score: String(score),
        notes: batchQaNotes,
        suppressToast: true,
      });
      if (ok) successCount += 1;
    }
    const failCount = qaSelectedIds.length - successCount;
    setBatchQaSubmitting(false);

    if (successCount > 0) {
      toast({
        title: "Batch QA complete",
        description: `${successCount} reviewed${failCount > 0 ? `, ${failCount} failed` : ""}.`,
      });
      await loadJobs();
      router.refresh();
      return;
    }
    toast({ title: "Batch QA failed", description: "No selected jobs were updated.", variant: "destructive" });
  }

  async function deleteJob(credentials?: { pin?: string; password?: string }) {
    if (!jobToDelete?.id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobToDelete.id}`, {
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
      setJobToDelete(null);
      await loadJobs();
      await loadPendingContinuations();
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err.message ?? "Could not delete job.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelectedJob(jobId: string) {
    setSelectedIds((current) => (current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]));
  }

  function toggleAllSelectedJobs() {
    if (filteredJobs.length === 0) return;
    setSelectedIds((current) => (current.length === filteredJobs.length ? [] : filteredJobs.map((job) => job.id)));
  }

  function clearBulkSelection() {
    setSelectedIds([]);
  }

  function savePreferredView() {
    try {
      window.localStorage.setItem(JOB_VIEW_STORAGE_KEY, viewPreferenceDraft);
    } catch {
      // Ignore storage failures.
    }
    setSavedView(viewPreferenceDraft);
    setView(viewPreferenceDraft);
    setViewOptionsOpen(false);
    toast({
      title: "Default view saved",
      description: `${viewPreferenceDraft === "list" ? "List" : "Board"} view will now load by default.`,
    });
  }

  function getSlaStatus(job: any): "overdue" | "due-soon" | null {
    if (!job?.dueTime || ["COMPLETED", "INVOICED", "SUBMITTED", "QA_REVIEW"].includes(String(job?.status ?? ""))) {
      return null;
    }
    const dueDate = new Date(job.scheduledDate);
    if (Number.isNaN(dueDate.getTime())) return null;
    const [hours, minutes] = String(job.dueTime)
      .split(":")
      .map((part) => Number(part));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    dueDate.setHours(hours, minutes, 0, 0);
    const deltaMs = dueDate.getTime() - Date.now();
    if (deltaMs < 0) return "overdue";
    if (deltaMs <= 30 * 60 * 1000) return "due-soon";
    return null;
  }

  async function submitBulkAssign() {
    if (selectedIds.length === 0 || !bulkCleanerId) {
      toast({ title: "Select jobs and a cleaner first.", variant: "destructive" });
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/admin/jobs/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: selectedIds, cleanerUserId: bulkCleanerId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not bulk assign jobs.");
      toast({ title: "Bulk assignment complete", description: `${body.updated ?? selectedIds.length} jobs updated.` });
      setBulkAssignOpen(false);
      clearBulkSelection();
      await loadJobs();
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Bulk assign failed",
        description: error?.message ?? "Could not bulk assign jobs.",
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function submitBulkStatus() {
    if (selectedIds.length === 0 || !bulkStatusValue) {
      toast({ title: "Select jobs and a status first.", variant: "destructive" });
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/admin/jobs/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: selectedIds, status: bulkStatusValue }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not bulk update job statuses.");
      toast({ title: "Bulk status update complete", description: `${body.updated ?? selectedIds.length} jobs updated.` });
      setBulkStatusOpen(false);
      clearBulkSelection();
      await loadJobs();
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Bulk status update failed",
        description: error?.message ?? "Could not bulk update job statuses.",
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
    }
  }

  function openQuickAssign(job: any) {
    if (!job?.id || job?.status !== "UNASSIGNED") return;
    setQuickAssignJob(job);
    setQuickAssignSelected([]);
    setQuickAssignOpen(true);
  }

  async function submitQuickAssign() {
    if (!quickAssignJob?.id) return;
    if (quickAssignSelected.length === 0) {
      toast({ title: "Select at least one cleaner.", variant: "destructive" });
      return;
    }
    setQuickAssignSubmitting(true);
    setQuickAssigningByJob((prev) => ({ ...prev, [quickAssignJob.id]: true }));
    try {
      const assignRes = await fetch(`/api/admin/jobs/${quickAssignJob.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: quickAssignSelected,
          primaryUserId: quickAssignSelected[0],
        }),
      });
      const assignBody = await assignRes.json().catch(() => ({}));
      if (!assignRes.ok) {
        throw new Error(assignBody.error ?? "Could not assign job.");
      }

      toast({
        title: "Assigned",
        description: `${quickAssignSelected.length} cleaner(s) assigned.`,
      });
      setQuickAssignOpen(false);
      setQuickAssignJob(null);
      setQuickAssignSelected([]);
      await loadJobs();
      await loadPendingContinuations();
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Quick assign failed",
        description: err.message ?? "Could not quick assign this job.",
        variant: "destructive",
      });
    } finally {
      setQuickAssignSubmitting(false);
      if (quickAssignJob?.id) {
        setQuickAssigningByJob((prev) => ({ ...prev, [quickAssignJob.id]: false }));
      }
    }
  }

  const groupedByStatus = JOB_STATUSES.reduce((acc, status) => {
    acc[status] = filteredJobs.filter((job) => job.status === status);
    return acc;
  }, {} as Record<string, any[]>);
  const statusCounts = useMemo(
    () =>
      JOB_STATUSES.reduce<Record<string, number>>((acc, status) => {
        acc[status] = jobs.filter((job) => job.status === status).length;
        return acc;
      }, {}),
    [jobs]
  );

  function getAssignmentNames(job: any) {
    const names = Array.isArray(job?.assignments)
      ? job.assignments
          .map((assignment: any) => assignment?.user?.name?.trim() || assignment?.user?.email?.trim() || "")
          .filter(Boolean)
      : [];
    return Array.from(new Set(names));
  }

  function hasActiveDamageCase(job: any) {
    return Array.isArray(job?.issueTickets) && job.issueTickets.length > 0;
  }

  const allFilteredSelected =
    filteredJobs.length > 0 && filteredJobs.every((job) => selectedIds.includes(job.id));

  const jobUrgentTotal = pendingContinuationRows.length + pendingTimingCount;

  // Selecting a quick status chip clears any explicit date inputs only when the
  // chip itself isn't a date concern; status + date compose freely otherwise.
  function applyStatusChip(chipId: string) {
    setFilters((current) => ({ ...current, status: chipId }));
  }

  // Quick date chip. Picking a chip clears the manual date-range inputs so the
  // two date controls never fight; "all" clears everything date-related.
  function applyDateChip(chip: DateFilter) {
    setFilters((current) => ({ ...current, dateFilter: chip, dateFrom: "", dateTo: "" }));
  }

  return (
    <div className="space-y-6">
      {jobUrgentTotal > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <span className="text-sm font-medium text-destructive">
              {jobUrgentTotal} job approval{jobUrgentTotal !== 1 ? "s" : ""} need your attention
              {pendingContinuationRows.length > 0 && (
                <span className="ml-2 text-muted-foreground font-normal">
                  ({pendingContinuationRows.length} continuation{pendingContinuationRows.length !== 1 ? "s" : ""}
                  {pendingTimingCount > 0 ? `, ${pendingTimingCount} timing` : ""})
                </span>
              )}
            </span>
          </div>
          <Button asChild size="sm" variant="destructive">
            <Link href="/admin/approvals">Review all</Link>
          </Button>
        </div>
      )}

      <PageHeader
        icon={<Briefcase />}
        title="Jobs"
        description={
          <>
            {pagination.totalCount} job{pagination.totalCount !== 1 ? "s" : ""}
            {pagination.totalPages > 1 && (
              <span className="text-muted-foreground"> &middot; Page {pagination.page} of {pagination.totalPages}</span>
            )}
          </>
        }
        actions={
          <>
          <Button variant="outline" onClick={() => setFiltersOpen((current) => !current)}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
            {activeFilterCount > 0 ? (
              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const params = buildJobsQuery({ limit: "5000" });
                const res = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
                const data = await res.json().catch(() => ({ jobs: [] }));
                const rows = (Array.isArray(data?.jobs) ? data.jobs : []).map((j: any) => ({
                  JobNumber: j.jobNumber ?? "",
                  Property: j.property?.name ?? "",
                  Suburb: j.property?.suburb ?? "",
                  Client: j.property?.client?.name ?? j.client?.name ?? "",
                  Type: (j.jobType ?? "").replace(/_/g, " "),
                  Status: STATUS_LABELS[j.status] ?? j.status,
                  ScheduledDate: j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString("en-AU") : "",
                  StartTime: j.startTime ?? "",
                  DueTime: j.dueTime ?? "",
                  AssignedTo: getAssignmentNames(j).join(", "),
                }));
                if (rows.length === 0) {
                  toast({ title: "No jobs to export", variant: "destructive" });
                  return;
                }
                const headers = Object.keys(rows[0]);
                const csv = [headers.join(","), ...rows.map((r: Record<string, string>) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(","))].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `jobs_export_${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast({ title: "Export complete", description: `${rows.length} jobs exported.` });
              } catch {
                toast({ title: "Export failed", variant: "destructive" });
              }
            }}
          >
            Export CSV
          </Button>
            <div className="flex rounded-md border">
              <Button
                variant={view === "list" ? "default" : "ghost"}
              size="icon"
              className="rounded-r-none"
              onClick={() => setView("list")}
              aria-label="Switch to list view"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "kanban" ? "default" : "ghost"}
              size="icon"
              className="rounded-l-none"
              onClick={() => setView("kanban")}
              aria-label="Switch to kanban view"
              >
                <Kanban className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                setViewPreferenceDraft(view);
                setViewOptionsOpen(true);
              }}
              aria-label="Jobs view options"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <span className="hidden text-xs text-muted-foreground xl:inline">
              Default view: {savedView === "list" ? "List" : "Board"}
            </span>
            <Button asChild>
              <Link href="/admin/jobs/new">
              <Plus className="mr-2 h-4 w-4" />
              New / Bulk
            </Link>
          </Button>
          </>
        }
      />

      <div className="space-y-3">
        {/* Quick date tabs (Australia/Sydney). Horizontally scrollable on mobile. */}
        <div className="-mx-1 flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
          {DATE_CHIPS.map((chip) => {
            const isActive = filters.dateFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => applyDateChip(chip.id)}
                className={
                  "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* Status filter chips replace the old Active/Completed tabs. */}
        <div className="-mx-1 flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
          {STATUS_CHIPS.map((chip) => {
            const isActive = filters.status === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => applyStatusChip(chip.id)}
                className={
                  "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        {filtersOpen ? (
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="md:col-span-2 xl:col-span-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={filters.status === "all" ? "default" : "outline"}
                  onClick={() => setFilters((current) => ({ ...current, status: "all" }))}
                >
                  All
                  <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px]">
                    {jobs.length}
                  </span>
                </Button>
                {JOB_STATUSES.map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={filters.status === status ? "default" : "outline"}
                    onClick={() => setFilters((current) => ({ ...current, status }))}
                  >
                    {STATUS_LABELS[status]}
                    <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px]">
                      {statusCounts[status] ?? 0}
                    </span>
                  </Button>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Search</p>
              <Input
                value={filters.search}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Property, suburb, client, job number"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Job type</p>
              <Select value={filters.jobType} onValueChange={(value) => setFilters((current) => ({ ...current, jobType: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All job types</SelectItem>
                  {jobTypeOptions.map((jobType) => (
                    <SelectItem key={jobType} value={jobType}>
                      {jobType.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Status</p>
              <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {JOB_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Cleaner</p>
              <Input
                value={filters.cleanerName}
                onChange={(event) => setFilters((current) => ({ ...current, cleanerName: event.target.value }))}
                placeholder="Assigned cleaner name"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Client</p>
              <Select value={filters.clientId} onValueChange={(value) => setFilters((current) => ({ ...current, clientId: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Property</p>
              <Select value={filters.propertyId} onValueChange={(value) => setFilters((current) => ({ ...current, propertyId: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All properties</SelectItem>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.suburb ? `${property.name} (${property.suburb})` : property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Date from</p>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, dateFilter: "all", dateFrom: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Date to</p>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, dateFilter: "all", dateTo: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Invoice status</p>
              <Select value={filters.invoiced} onValueChange={(value) => setFilters((current) => ({ ...current, invoiced: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="yes">Invoiced</SelectItem>
                  <SelectItem value="no">Not invoiced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-end">
              <Button variant="ghost" onClick={() => setFilters(JOB_FILTER_DEFAULTS)}>
                Clear all
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : view === "list" ? (
        <div className="space-y-4">
          {pendingContinuationRows.length > 0 ? (
            <Card className="border-warning/40 bg-warning/10">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Pause / Continuation Requests</p>
                    <p className="text-xs text-muted-foreground">
                      These jobs are waiting for admin reschedule approval.
                    </p>
                  </div>
                  <Badge variant="warning">{pendingContinuationRows.length} pending</Badge>
                </div>
                <div className="space-y-2">
                  {pendingContinuationRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-col gap-3 rounded-md border border-warning/40 bg-surface p-3 md:flex-row md:items-start md:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {row.job?.property?.name ?? "Job"}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {row.job?.property?.suburb ? `- ${row.job.property.suburb}` : ""}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.job?.jobType ? String(row.job.jobType).replace(/_/g, " ") : "Job"}{" "}
                          {row.job?.scheduledDate ? `- ${format(new Date(row.job.scheduledDate), "dd MMM yyyy")}` : ""}
                        </p>
                        <p className="mt-1 text-xs">
                          <strong>Cleaner:</strong> {row.requestedBy?.name ?? row.requestedBy?.email ?? "Unknown"}
                        </p>
                        <p className="mt-1 text-xs">
                          <strong>Reason:</strong> {row.reason}
                        </p>
                        {row.preferredDate ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Preferred continuation date: {format(new Date(`${row.preferredDate}T00:00:00`), "dd MMM yyyy")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive">Waiting Approval</Badge>
                        <Button size="sm" asChild>
                          <Link href={`/admin/jobs/${row.jobId}`}>Review job</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">QA Queue</p>
                  <p className="text-xs text-muted-foreground">
                    Review submitted jobs inline without opening each job.
                  </p>
                </div>
                <Badge variant="warning">{qaQueueJobs.length} awaiting QA</Badge>
              </div>

              {qaQueueJobs.length > 0 ? (
                <>
                  <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[140px_1fr_auto]">
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Batch score</p>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={batchQaScore}
                        onChange={(e) => setBatchQaScore(e.target.value)}
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Batch notes (optional)</p>
                      <Textarea
                        rows={2}
                        value={batchQaNotes}
                        onChange={(e) => setBatchQaNotes(e.target.value)}
                        placeholder="Applies to selected jobs"
                      />
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          setQaSelectedIds(
                            qaSelectedIds.length === qaQueueJobs.length ? [] : qaQueueJobs.map((job) => job.id)
                          )
                        }
                      >
                        {qaSelectedIds.length === qaQueueJobs.length ? "Clear selection" : "Select all"}
                      </Button>
                      <Button onClick={submitBatchQa} disabled={batchQaSubmitting || qaSelectedIds.length === 0}>
                        {batchQaSubmitting ? "Applying..." : `Apply to selected (${qaSelectedIds.length})`}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {qaQueueJobs.map((job) => (
                      <div
                        key={job.id}
                        className="grid gap-2 rounded-md border p-3 md:grid-cols-[30px_1.2fr_100px_1fr_auto]"
                      >
                        <div className="pt-1">
                          <Checkbox
                            checked={qaSelectedIds.includes(job.id)}
                            onCheckedChange={() => toggleQaSelection(job.id)}
                          />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{job.property.name}</p>
                            {job.jobNumber ? (
                              <Badge
                                variant="warning"
                                className="border-amber-300 bg-amber-100 text-[10px] font-semibold uppercase tracking-wide text-amber-950"
                              >
                                {job.jobNumber}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {job.property.suburb} - {job.jobType.replace(/_/g, " ")} -{" "}
                            {format(new Date(job.scheduledDate), "dd MMM yyyy")}
                          </p>
                          {job.qaReviews?.[0] ? (
                            <p className="text-xs text-muted-foreground">
                              Last QA: {Math.round(job.qaReviews[0].score)}% ({job.qaReviews[0].passed ? "Passed" : "Failed"})
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-muted-foreground">Score</p>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={qaScoreByJob[job.id] ?? "90"}
                            onChange={(e) => setQaScoreByJob((prev) => ({ ...prev, [job.id]: e.target.value }))}
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-muted-foreground">Notes</p>
                          <Input
                            value={qaNotesByJob[job.id] ?? ""}
                            onChange={(e) => setQaNotesByJob((prev) => ({ ...prev, [job.id]: e.target.value }))}
                            placeholder="Optional QA notes"
                          />
                        </div>
                        <div className="flex flex-wrap items-end justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const ok = await submitQaReview(job.id, { score: "95", notes: qaNotesByJob[job.id] ?? "" });
                              if (ok) {
                                await loadJobs();
                                router.refresh();
                              }
                            }}
                            disabled={Boolean(qaSubmittingByJob[job.id])}
                          >
                            Quick Pass
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const ok = await submitQaReview(job.id, { score: "60", notes: qaNotesByJob[job.id] ?? "" });
                              if (ok) {
                                await loadJobs();
                                router.refresh();
                              }
                            }}
                            disabled={Boolean(qaSubmittingByJob[job.id])}
                          >
                            Flag Rework
                          </Button>
                          <Button
                            size="sm"
                            onClick={async () => {
                              const ok = await submitQaReview(job.id);
                              if (ok) {
                                await loadJobs();
                                router.refresh();
                              }
                            }}
                            disabled={Boolean(qaSubmittingByJob[job.id])}
                          >
                            {qaSubmittingByJob[job.id] ? "Saving..." : "Save QA"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No jobs currently waiting for QA review.</p>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Showing {jobs.length} of {pagination.totalCount} jobs (Page {pagination.page} of {pagination.totalPages || 1})
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => loadJobs(pagination.page - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasMore}
                onClick={() => loadJobs(pagination.page + 1)}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {filteredJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    selected={selectedIds.includes(job.id)}
                    onToggleSelect={toggleSelectedJob}
                    onQuickAssign={openQuickAssign}
                    onDelete={(j) => {
                      setJobToDelete(j);
                      setDeleteOpen(true);
                    }}
                    quickAssigning={Boolean(quickAssigningByJob[job.id])}
                    pendingContinuation={pendingContinuationJobIds.has(job.id)}
                    pendingReschedule={pendingRescheduleJobIds.has(job.id)}
                    slaStatus={getSlaStatus(job)}
                  />
                ))}
                {filteredJobs.length === 0 ? (
                  <p className="px-6 py-10 text-center text-sm text-muted-foreground">No jobs match filters.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW", "COMPLETED"].map((status) => (
            <div key={status} className="min-w-[260px] flex-shrink-0">
              <div className="mb-3 flex items-center gap-2">
                <Badge variant={STATUS_COLORS[status] as any}>{STATUS_LABELS[status]}</Badge>
                <span className="text-xs text-muted-foreground">{groupedByStatus[status]?.length}</span>
              </div>
              <div className="space-y-2">
                  {(groupedByStatus[status] ?? [])
                    .slice(0, kanbanVisibleCounts[status] ?? (status === "UNASSIGNED" ? KANBAN_COLUMN_PREVIEW : groupedByStatus[status]?.length ?? 0))
                    .map((job) => (
                    (() => {
                    const assignmentNames = getAssignmentNames(job);
                    const slaStatus = getSlaStatus(job);
                    return (
                  <Card
                    key={job.id}
                    className={`transition-colors hover:border-primary/50 ${
                      pendingContinuationJobIds.has(job.id) ? "border-warning/40 bg-warning/10" : ""
                    }`}
                  >
                    <CardContent className="p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Checkbox
                          checked={selectedIds.includes(job.id)}
                          onCheckedChange={() => toggleSelectedJob(job.id)}
                        />
                        <span className="text-xs text-muted-foreground">Select</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/jobs/${job.id}`} className="font-medium text-sm hover:underline">
                          {job.property?.name ?? "Unknown property"}
                        </Link>
                        {job.jobNumber ? (
                          <Badge
                            variant="warning"
                            className="border-amber-300 bg-amber-100 text-[10px] font-semibold uppercase tracking-wide text-amber-950 tabular-nums"
                          >
                            {job.jobNumber}
                          </Badge>
                        ) : null}
                        {hasActiveDamageCase(job) ? (
                          <Button size="sm" variant="outline" asChild className="h-6 border-red-300 px-2 text-red-700 hover:bg-red-50 hover:text-red-800">
                            <Link href={`/admin/cases?jobId=${job.id}`}>
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              Damage
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{job.property?.suburb ?? ""}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {job.jobType ? String(job.jobType).replace(/_/g, " ") : "Job"}
                      </p>
                      <p className="mt-1 text-xs font-medium tabular-nums">
                        {job.scheduledDate && !Number.isNaN(new Date(job.scheduledDate).getTime())
                          ? format(toZonedTime(new Date(job.scheduledDate), TZ), "dd MMM")
                          : "No date"}
                      </p>
                      {pendingContinuationJobIds.has(job.id) ? (
                        <Badge variant="destructive" className="mt-2">
                          Continuation pending
                        </Badge>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {job.gpsDistanceMeters != null ? (
                          <Badge variant={job.gpsDistanceMeters < 500 ? "success" : "warning"}>
                            {job.gpsDistanceMeters < 500 ? "On-site" : `${job.gpsDistanceMeters}m away`}
                          </Badge>
                        ) : null}
                        {slaStatus === "overdue" ? <Badge variant="destructive">Overdue</Badge> : null}
                        {slaStatus === "due-soon" ? <Badge variant="warning">Due soon</Badge> : null}
                      </div>
                      {assignmentNames.length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">- {assignmentNames.join(", ")}</p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        {status === "UNASSIGNED" ? (
                          <Button
                            size="sm"
                            onClick={() => openQuickAssign(job)}
                            className="flex-1"
                            disabled={Boolean(quickAssigningByJob[job.id])}
                          >
                            <UserPlus className="mr-1 h-4 w-4" />
                            {quickAssigningByJob[job.id] ? "Assigning..." : "Quick Assign"}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" asChild className="flex-1">
                          <Link href={`/admin/jobs/${job.id}`}>View</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1"
                          onClick={() => {
                            setJobToDelete(job);
                            setDeleteOpen(true);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                    );
                  })()
                ))}
                  {groupedByStatus[status]?.length === 0 ? (
                    <div className="rounded-lg border-2 border-dashed p-4 text-center text-xs text-muted-foreground">
                      Empty
                    </div>
                  ) : null}
                  {status === "UNASSIGNED" && (groupedByStatus[status]?.length ?? 0) > (kanbanVisibleCounts[status] ?? KANBAN_COLUMN_PREVIEW) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        setKanbanVisibleCounts((current) => ({
                          ...current,
                          [status]: (current[status] ?? KANBAN_COLUMN_PREVIEW) + KANBAN_COLUMN_PREVIEW,
                        }))
                      }
                    >
                      Load more unassigned
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
        </div>
      )}
      </div>

      {selectedIds.length > 0 ? (
        <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllSelectedJobs} />
            <span className="text-sm font-medium">{selectedIds.length} selected</span>
          </div>
          <Button size="sm" onClick={() => setBulkAssignOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Bulk assign
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkStatusOpen(true)}>
            Change status
          </Button>
          <Button size="sm" variant="ghost" onClick={clearBulkSelection}>
            Clear
          </Button>
        </div>
      ) : null}

      <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Assign Cleaner</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Cleaner</Label>
              <Select value={bulkCleanerId} onValueChange={setBulkCleanerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose cleaner" />
                </SelectTrigger>
                <SelectContent>
                  {cleaners.map((cleaner) => (
                    <SelectItem key={cleaner.id} value={cleaner.id}>
                      {cleaner.name || cleaner.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              This assigns the selected cleaner to {selectedIds.length} selected jobs and moves unassigned jobs to Assigned.
            </p>
            <Button onClick={submitBulkAssign} disabled={bulkSubmitting || !bulkCleanerId}>
              {bulkSubmitting ? "Applying..." : "Apply assignment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkStatusOpen} onOpenChange={setBulkStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Change Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Status</Label>
              <Select value={bulkStatusValue} onValueChange={setBulkStatusValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose status" />
                </SelectTrigger>
                <SelectContent>
                  {JOB_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              This applies the selected status to {selectedIds.length} selected jobs.
            </p>
            <Button onClick={submitBulkStatus} disabled={bulkSubmitting || !bulkStatusValue}>
              {bulkSubmitting ? "Applying..." : "Update status"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={quickAssignOpen}
        onOpenChange={(open) => {
          setQuickAssignOpen(open);
          if (!open) {
            setQuickAssignJob(null);
            setQuickAssignSelected([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quick Assign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="font-medium">{quickAssignJob?.property?.name ?? "Unassigned job"}</p>
              <p className="text-xs text-muted-foreground">
                {quickAssignJob?.jobType ? String(quickAssignJob.jobType).replace(/_/g, " ") : "-"} -{" "}
                {quickAssignJob?.scheduledDate ? format(new Date(quickAssignJob.scheduledDate), "dd MMM yyyy") : "-"}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Select cleaner(s)</p>
              <MultiSelectDropdown
                options={cleanerOptions}
                selected={quickAssignSelected}
                onChange={setQuickAssignSelected}
                placeholder="Choose cleaners"
                emptyText="No active cleaner accounts."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setQuickAssignOpen(false);
                  setQuickAssignJob(null);
                  setQuickAssignSelected([]);
                }}
                disabled={quickAssignSubmitting}
              >
                Cancel
              </Button>
              <Button onClick={submitQuickAssign} disabled={quickAssignSubmitting}>
                {quickAssignSubmitting ? "Assigning..." : "Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={viewOptionsOpen} onOpenChange={setViewOptionsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Jobs View Options</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Default view</Label>
              <Select
                value={viewPreferenceDraft}
                onValueChange={(value: "list" | "kanban") => setViewPreferenceDraft(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list">List</SelectItem>
                  <SelectItem value="kanban">Board</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              Current view:{" "}
              <span className="font-medium text-foreground">{view === "list" ? "List" : "Board"}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setViewOptionsOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={savePreferredView}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete job"
        description={
          jobToDelete
            ? `This will permanently delete the job for ${jobToDelete.property?.name ?? "this property"} on ${format(new Date(jobToDelete.scheduledDate), "dd MMM yyyy")}.`
            : "This will permanently delete the selected job."
        }
        actionKey="deleteJob"
        confirmLabel="Delete job"
        requireSecurityVerification
        loading={deleting}
        onConfirm={deleteJob}
      />
    </div>
  );
}
