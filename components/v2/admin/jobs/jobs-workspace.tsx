"use client";

/**
 * ESTATE jobs workspace — the v2-native rebuild of the admin jobs list.
 * Same data plane as v1 (/api/jobs with paginated=1, statusGroup/status,
 * sort, dateFrom/dateTo; bulk-assign / bulk-status / assign mutations),
 * entirely new Estate presentation: date-scope tabs, status chips, list ⇄
 * board toggle, serif rows, bulk bar, CSV export.
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobType } from "@prisma/client";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutGrid,
  Rows3,
  Search,
  SlidersHorizontal,
  UserRoundPlus,
  X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard, EEmptyState, EEyebrow } from "@/components/v2/ui/primitives";
import {
  EBoardCard,
  ECheck,
  EJobRow,
  assignmentNames,
  scheduledLabel,
  statusLabel,
} from "./job-row";
import { JobManageModal } from "./job-manage";

const TZ = "Australia/Sydney";
const PAGE_SIZE = 50;

/* ── Date scope (Australia/Sydney) ─────────────────────────────────────── */
type DateScope = "today" | "tomorrow" | "upcoming" | "past" | "all";
const DATE_SCOPES: { id: DateScope; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
];

function sydneyKey(offsetDays = 0): string {
  const base = toZonedTime(new Date(), TZ);
  return format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays), "yyyy-MM-dd");
}

function scopeRange(scope: DateScope): { dateFrom?: string; dateTo?: string } {
  if (scope === "today") return { dateFrom: sydneyKey(0), dateTo: sydneyKey(0) };
  if (scope === "tomorrow") return { dateFrom: sydneyKey(1), dateTo: sydneyKey(1) };
  if (scope === "upcoming") return { dateFrom: sydneyKey(1) };
  if (scope === "past") return { dateTo: sydneyKey(-1) };
  return {};
}

/* ── Status chips (virtual groups + single statuses, same as v1) ───────── */
const STATUS_CHIPS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "UNASSIGNED", label: "Unassigned" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "QA_REVIEW", label: "QA review" },
  { id: "COMPLETED", label: "Completed" },
  { id: "INVOICED", label: "Invoiced" },
];

/* ── Sort (server-side, same param values as v1) ───────────────────────── */
type JobSort = "soonest" | "latest" | "created" | "property" | "status";
const SORT_OPTIONS: { id: JobSort; label: string }[] = [
  { id: "soonest", label: "Soonest scheduled" },
  { id: "latest", label: "Latest scheduled" },
  { id: "created", label: "Recently created" },
  { id: "property", label: "Property A–Z" },
  { id: "status", label: "Status" },
];

/* ── Job type options (from the JobType enum, Title-cased) ─────────────── */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
const JOB_TYPE_OPTIONS: { id: string; label: string }[] = Object.values(JobType).map((value) => ({
  id: String(value),
  label: titleCase(String(value)),
}));

/* ── Invoice status (client-side over the returned rows) ───────────────── */
type InvoiceFilter = "all" | "yes" | "no";
const INVOICE_OPTIONS: { id: InvoiceFilter; label: string }[] = [
  { id: "all", label: "Any invoice status" },
  { id: "yes", label: "Invoiced" },
  { id: "no", label: "Not invoiced" },
];

/* ── Board columns: 4 Estate lanes over the full status ladder ─────────── */
const BOARD_LANES: { id: string; label: string; statuses: string[] }[] = [
  { id: "unassigned", label: "Unassigned", statuses: ["UNASSIGNED", "OFFERED"] },
  { id: "scheduled", label: "Scheduled", statuses: ["ASSIGNED", "EN_ROUTE"] },
  { id: "inprogress", label: "In progress", statuses: ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] },
  { id: "done", label: "Done", statuses: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
];

const BULK_STATUSES = [
  "UNASSIGNED",
  "OFFERED",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "PAUSED",
  "SUBMITTED",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
];

type Cleaner = { id: string; name: string; email: string };
type Pagination = { page: number; limit: number; totalCount: number; totalPages: number; hasMore: boolean };

/* ── Estate-native form atoms (no components/ui imports) ───────────────── */
const FIELD_CLS =
  "h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 " +
  "text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

function EModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[hsl(var(--e-shadow-color)/0.45)]" onClick={onClose} />
      <div className="e-rise relative w-full max-w-md rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-surface))] p-6 shadow-[var(--e-elevation-3)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <EEyebrow className="mb-1">Jobs</EEyebrow>
            <h3 className="e-display-sm">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1.5 text-[hsl(var(--e-text-faint))] transition-colors hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/* ── Workspace ─────────────────────────────────────────────────────────── */
export function JobsWorkspace() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: PAGE_SIZE, totalCount: 0, totalPages: 0, hasMore: false });
  const [loading, setLoading] = useState(true);

  const [dateScope, setDateScope] = useState<DateScope>("all");
  const [statusChip, setStatusChip] = useState("active");
  const [sort, setSort] = useState<JobSort>("soonest");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "board">("list");

  // v1-parity server filters (jobType/client/property/explicit range) + the
  // client-side invoice-status refinement.
  const [jobType, setJobType] = useState("all");
  const [clientId, setClientId] = useState("all");
  const [propertyId, setPropertyId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [invoiced, setInvoiced] = useState<InvoiceFilter>("all");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string; suburb: string }[]>([]);

  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [assignJob, setAssignJob] = useState<any | null>(null);
  const [manageJob, setManageJob] = useState<any | null>(null);
  const [assignSelected, setAssignSelected] = useState<string[]>([]);
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkCleanerId, setBulkCleanerId] = useState("");
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("ASSIGNED");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  function buildQuery(overrides?: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams({ paginated: "1" });
    if (statusChip === "active" || statusChip === "completed") params.set("statusGroup", statusChip);
    else if (statusChip !== "all") params.set("status", statusChip);
    params.set("sort", sort);
    if (jobType !== "all") params.set("jobType", jobType);
    if (clientId !== "all") params.set("clientId", clientId);
    if (propertyId !== "all") params.set("propertyId", propertyId);
    // An explicit from/to range overrides the scope-tab range.
    if (dateFrom || dateTo) {
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
    } else {
      const range = scopeRange(dateScope);
      if (range.dateFrom) params.set("dateFrom", range.dateFrom);
      if (range.dateTo) params.set("dateTo", range.dateTo);
    }
    if (overrides) for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return params;
  }

  async function loadJobs(page = 1) {
    setLoading(true);
    try {
      const params = buildQuery({ page: String(page), limit: String(PAGE_SIZE) });
      const res = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({ jobs: [], pagination: null }));
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      if (data?.pagination) setPagination(data.pagination);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateScope, statusChip, sort, jobType, clientId, propertyId, dateFrom, dateTo]);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next = Array.isArray(rows)
          ? rows
              .map((row: any) => ({ id: String(row.id ?? ""), name: String(row.name ?? "").trim() }))
              .filter((row: { id: string }) => row.id)
          : [];
        setClients(next);
      })
      .catch(() => setClients([]));

    fetch("/api/admin/properties?includeOneOff=1")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next = Array.isArray(rows)
          ? rows
              .map((row: any) => ({
                id: String(row.id ?? ""),
                name: String(row.name ?? "").trim(),
                suburb: String(row.suburb ?? "").trim(),
              }))
              .filter((row: { id: string }) => row.id)
          : [];
        setProperties(next);
      })
      .catch(() => setProperties([]));
  }, []);

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
              .filter((row: Cleaner) => row.id)
          : [];
        setCleaners(next);
      })
      .catch(() => setCleaners([]));
  }, []);

  /* Client-side refinement over the server page (search + invoice status),
     same approach as v1. */
  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (invoiced !== "all") {
        const isInvoiced =
          String(job?.status ?? "") === "INVOICED" ||
          Boolean(job?.invoiceId) ||
          Boolean(job?.invoice?.id) ||
          Boolean(job?.clientInvoiceLineId) ||
          Boolean(job?.clientInvoiceLine?.id);
        if (invoiced === "yes" && !isInvoiced) return false;
        if (invoiced === "no" && isInvoiced) return false;
      }
      if (!needle) return true;
      const haystack = [
        job.jobNumber,
        job.property?.name,
        job.property?.suburb,
        job.property?.client?.name,
        job.property?.client?.email,
        job.client?.name,
        ...assignmentNames(job),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [jobs, search, invoiced]);

  useEffect(() => {
    const allowed = new Set(filteredJobs.map((job) => job.id));
    setSelectedIds((current) => current.filter((id) => allowed.has(id)));
  }, [filteredJobs]);

  const allSelected = filteredJobs.length > 0 && filteredJobs.every((job) => selectedIds.includes(job.id));

  function toggleSelect(jobId: string) {
    setSelectedIds((current) => (current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]));
  }

  function toggleSelectAll() {
    if (filteredJobs.length === 0) return;
    setSelectedIds(allSelected ? [] : filteredJobs.map((job) => job.id));
  }

  function openAssign(job: any) {
    setAssignJob(job);
    setAssignSelected([]);
  }

  async function submitAssign() {
    if (!assignJob?.id || assignSelected.length === 0) {
      toast({ title: "Select at least one cleaner.", variant: "destructive" });
      return;
    }
    setAssignSubmitting(true);
    try {
      const res = await fetch(`/api/admin/jobs/${assignJob.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: assignSelected, primaryUserId: assignSelected[0] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not assign job.");
      toast({ title: "Assigned", description: `${assignSelected.length} cleaner(s) assigned.` });
      setAssignJob(null);
      await loadJobs(pagination.page);
    } catch (err: any) {
      toast({ title: "Assign failed", description: err?.message ?? "Could not assign job.", variant: "destructive" });
    } finally {
      setAssignSubmitting(false);
    }
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
      setSelectedIds([]);
      await loadJobs(pagination.page);
    } catch (err: any) {
      toast({ title: "Bulk assign failed", description: err?.message ?? "Request failed.", variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function submitBulkStatus() {
    if (selectedIds.length === 0 || !bulkStatus) {
      toast({ title: "Select jobs and a status first.", variant: "destructive" });
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/admin/jobs/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: selectedIds, status: bulkStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not bulk update job statuses.");
      toast({ title: "Bulk status update complete", description: `${body.updated ?? selectedIds.length} jobs updated.` });
      setBulkStatusOpen(false);
      setSelectedIds([]);
      await loadJobs(pagination.page);
    } catch (err: any) {
      toast({ title: "Bulk status failed", description: err?.message ?? "Request failed.", variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const params = buildQuery({ limit: "5000" });
      const res = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({ jobs: [] }));
      const rows = (Array.isArray(data?.jobs) ? data.jobs : []).map((j: any) => ({
        JobNumber: j.jobNumber ?? "",
        Property: j.property?.name ?? "",
        Suburb: j.property?.suburb ?? "",
        Client: j.property?.client?.name ?? j.client?.name ?? "",
        Type: String(j.jobType ?? "").replace(/_/g, " "),
        Status: statusLabel(String(j.status ?? "")),
        ScheduledDate: j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString("en-AU") : "",
        StartTime: j.startTime ?? "",
        DueTime: j.dueTime ?? "",
        AssignedTo: assignmentNames(j).join(", "),
      }));
      if (rows.length === 0) {
        toast({ title: "No jobs to export", variant: "destructive" });
        return;
      }
      const headers = Object.keys(rows[0]);
      const csv = [
        headers.join(","),
        ...rows.map((r: Record<string, string>) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");
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
    } finally {
      setExporting(false);
    }
  }

  const hasActiveFilters =
    jobType !== "all" ||
    clientId !== "all" ||
    propertyId !== "all" ||
    invoiced !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  function resetFilters() {
    setJobType("all");
    setClientId("all");
    setPropertyId("all");
    setInvoiced("all");
    setDateFrom("");
    setDateTo("");
  }

  const boardLanes = useMemo(
    () =>
      BOARD_LANES.map((lane) => ({
        ...lane,
        jobs: filteredJobs.filter((job) => lane.statuses.includes(String(job?.status ?? ""))),
      })),
    [filteredJobs]
  );

  return (
    <div className="space-y-5">
      {/* ── Command bar: date scope · search · sort · view ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-1">
          {DATE_SCOPES.map((scope) => (
            <button
              key={scope.id}
              type="button"
              onClick={() => setDateScope(scope.id)}
              className={
                "rounded-[var(--e-radius-sm)] px-3.5 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] " +
                (dateScope === scope.id
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {scope.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search property, client, cleaner, job number…"
            className={FIELD_CLS + " pl-9"}
          />
        </div>

        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as JobSort)}
          aria-label="Sort jobs"
          className={FIELD_CLS + " w-auto min-w-[180px] cursor-pointer"}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] p-0.5">
          <button
            type="button"
            aria-label="List view"
            onClick={() => setView("list")}
            className={
              "rounded-[var(--e-radius-sm)] p-2 transition-colors duration-[160ms] " +
              (view === "list"
                ? "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                : "text-[hsl(var(--e-text-faint))] hover:text-[hsl(var(--e-foreground))]")
            }
          >
            <Rows3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Board view"
            onClick={() => setView("board")}
            className={
              "rounded-[var(--e-radius-sm)] p-2 transition-colors duration-[160ms] " +
              (view === "board"
                ? "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                : "text-[hsl(var(--e-text-faint))] hover:text-[hsl(var(--e-foreground))]")
            }
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        <EButton variant="outline" size="md" onClick={exportCsv} disabled={exporting}>
          <Download className="h-4 w-4" />
          {exporting ? "Exporting…" : "Export"}
        </EButton>
      </div>

      {/* ── Status chips ── */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_CHIPS.map((chip) => {
          const active = statusChip === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setStatusChip(chip.id)}
              className={
                "rounded-[var(--e-radius-pill)] border px-3.5 py-1.5 text-[0.75rem] font-[550] tracking-[0.02em] transition-colors duration-[160ms] " +
                (active
                  ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                  : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:border-[hsl(var(--e-gold))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {chip.label}
            </button>
          );
        })}
        <span className="ml-auto text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="e-numeral text-[0.9375rem] text-[hsl(var(--e-foreground))]">{pagination.totalCount}</span>{" "}
          job{pagination.totalCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Refined filters: type · client · property · explicit range · invoice ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised)/0.5)] px-4 py-3">
        <span className="flex items-center gap-1.5 self-center text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
        </span>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Job type</span>
          <select
            value={jobType}
            onChange={(event) => setJobType(event.target.value)}
            aria-label="Filter by job type"
            className={FIELD_CLS + " w-auto min-w-[160px] cursor-pointer"}
          >
            <option value="all">All types</option>
            {JOB_TYPE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Client</span>
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            aria-label="Filter by client"
            className={FIELD_CLS + " w-auto min-w-[160px] cursor-pointer"}
          >
            <option value="all">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name || client.id}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Property</span>
          <select
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            aria-label="Filter by property"
            className={FIELD_CLS + " w-auto min-w-[160px] cursor-pointer"}
          >
            <option value="all">All properties</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name || property.id}
                {property.suburb ? ` · ${property.suburb}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            aria-label="Scheduled from date"
            className={FIELD_CLS + " w-auto min-w-[150px] cursor-pointer"}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            aria-label="Scheduled to date"
            className={FIELD_CLS + " w-auto min-w-[150px] cursor-pointer"}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Invoice</span>
          <select
            value={invoiced}
            onChange={(event) => setInvoiced(event.target.value as InvoiceFilter)}
            aria-label="Filter by invoice status"
            className={FIELD_CLS + " w-auto min-w-[160px] cursor-pointer"}
          >
            {INVOICE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters ? (
          <EButton variant="ghost" size="sm" onClick={resetFilters} className="self-center">
            <X className="h-3.5 w-3.5" />
            Clear filters
          </EButton>
        ) : null}
        {(dateFrom || dateTo) ? (
          <span className="self-center text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            Custom range overrides the scope tabs.
          </span>
        ) : null}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <ECard className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Preparing the ledger…
        </ECard>
      ) : filteredJobs.length === 0 ? (
        <EEmptyState
          eyebrow="Operations"
          title="Nothing on the books"
          description="No jobs match the current scope. Adjust the date range, status, or search."
        />
      ) : view === "list" ? (
        <ECard className="overflow-hidden">
          {/* header rule with select-all */}
          <div className="flex items-center gap-4 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised)/0.5)] px-5 py-2.5">
            <ECheck checked={allSelected} onChange={toggleSelectAll} label="Select all jobs" />
            <EEyebrow className="text-[0.5625rem]">
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Engagements"}
            </EEyebrow>
          </div>
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {filteredJobs.map((job) => (
              <EJobRow
                key={job.id}
                job={job}
                selected={selectedIds.includes(job.id)}
                onToggleSelect={toggleSelect}
                onQuickAssign={openAssign}
                onManage={setManageJob}
              />
            ))}
          </div>
        </ECard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {boardLanes.map((lane) => (
            <div key={lane.id} className="min-w-0">
              <div className="mb-3 flex items-baseline justify-between border-b border-[hsl(var(--e-border))] pb-2">
                <EEyebrow>{lane.label}</EEyebrow>
                <span className="e-numeral text-[1rem]">{lane.jobs.length}</span>
              </div>
              <div className="space-y-2.5">
                {lane.jobs.map((job) => (
                  <EBoardCard
                    key={job.id}
                    job={job}
                    selected={selectedIds.includes(job.id)}
                    onToggleSelect={toggleSelect}
                    onQuickAssign={openAssign}
                    onManage={setManageJob}
                  />
                ))}
                {lane.jobs.length === 0 ? (
                  <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-4 py-8 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    Empty
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Page <span className="e-numeral">{pagination.page}</span> of{" "}
            <span className="e-numeral">{pagination.totalPages}</span>
          </p>
          <div className="flex items-center gap-2">
            <EButton variant="outline" size="sm" disabled={pagination.page <= 1 || loading} onClick={() => loadJobs(pagination.page - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </EButton>
            <EButton variant="outline" size="sm" disabled={!pagination.hasMore || loading} onClick={() => loadJobs(pagination.page + 1)}>
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </EButton>
          </div>
        </div>
      ) : null}

      {/* ── Bulk action bar ── */}
      {selectedIds.length > 0 ? (
        <div className="sticky bottom-5 z-30 mx-auto flex w-fit flex-wrap items-center gap-3 rounded-[var(--e-radius-xl)] border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-surface)/0.96)] px-5 py-3 shadow-[var(--e-elevation-3)] backdrop-blur">
          <p className="text-[0.875rem]">
            <span className="e-numeral text-[1rem]">{selectedIds.length}</span> selected
          </p>
          <EButton size="sm" variant="gold" onClick={() => setBulkAssignOpen(true)}>
            <UserRoundPlus className="h-3.5 w-3.5" />
            Bulk assign
          </EButton>
          <EButton size="sm" variant="outline" onClick={() => setBulkStatusOpen(true)}>
            Change status
          </EButton>
          <EButton size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
            Clear
          </EButton>
        </div>
      ) : null}

      {/* ── Manage job (reschedule · pricing · skip · danger) ── */}
      <JobManageModal
        job={manageJob}
        open={Boolean(manageJob)}
        onClose={() => setManageJob(null)}
        onChanged={() => loadJobs(pagination.page)}
      />

      {/* ── Quick assign ── */}
      <EModal open={Boolean(assignJob)} title="Assign cleaners" onClose={() => setAssignJob(null)}>
        <div className="space-y-4">
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] p-3">
            <p className="e-serif text-[0.9375rem] font-[520]">{assignJob?.property?.name ?? "Unassigned job"}</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {String(assignJob?.jobType ?? "").replace(/_/g, " ").toLowerCase() || "job"} ·{" "}
              {scheduledLabel(assignJob?.scheduledDate, "dd MMM yyyy")}
              {assignJob?.startTime ? ` · ${assignJob.startTime}` : ""}
            </p>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {cleaners.length === 0 ? (
              <p className="py-4 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No active cleaner accounts.</p>
            ) : (
              cleaners.map((cleaner) => {
                const checked = assignSelected.includes(cleaner.id);
                return (
                  <button
                    key={cleaner.id}
                    type="button"
                    onClick={() =>
                      setAssignSelected((current) =>
                        checked ? current.filter((id) => id !== cleaner.id) : [...current, cleaner.id]
                      )
                    }
                    className={
                      "flex w-full items-center gap-3 rounded-[var(--e-radius)] border px-3 py-2 text-left transition-colors duration-[160ms] " +
                      (checked
                        ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                        : "border-transparent hover:bg-[hsl(var(--e-muted))]")
                    }
                  >
                    <ECheck checked={checked} onChange={() => {}} label={cleaner.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.875rem] font-[550]">{cleaner.name || cleaner.email}</span>
                      <span className="block truncate text-[0.75rem] text-[hsl(var(--e-text-faint))]">{cleaner.email}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setAssignJob(null)} disabled={assignSubmitting}>
              Cancel
            </EButton>
            <EButton variant="gold" onClick={submitAssign} disabled={assignSubmitting || assignSelected.length === 0}>
              {assignSubmitting ? "Assigning…" : `Assign${assignSelected.length > 0 ? ` (${assignSelected.length})` : ""}`}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* ── Bulk assign ── */}
      <EModal open={bulkAssignOpen} title="Bulk assign cleaner" onClose={() => setBulkAssignOpen(false)}>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Cleaner</p>
            <select value={bulkCleanerId} onChange={(event) => setBulkCleanerId(event.target.value)} className={FIELD_CLS + " cursor-pointer"}>
              <option value="">Choose cleaner…</option>
              {cleaners.map((cleaner) => (
                <option key={cleaner.id} value={cleaner.id}>
                  {cleaner.name || cleaner.email}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Assigns this cleaner to the {selectedIds.length} selected jobs; unassigned jobs move to Assigned.
          </p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setBulkAssignOpen(false)} disabled={bulkSubmitting}>
              Cancel
            </EButton>
            <EButton variant="gold" onClick={submitBulkAssign} disabled={bulkSubmitting || !bulkCleanerId}>
              {bulkSubmitting ? "Applying…" : "Apply assignment"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* ── Bulk status ── */}
      <EModal open={bulkStatusOpen} title="Bulk change status" onClose={() => setBulkStatusOpen(false)}>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Status</p>
            <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} className={FIELD_CLS + " cursor-pointer"}>
              {BULK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Applies this status to the {selectedIds.length} selected jobs.
          </p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setBulkStatusOpen(false)} disabled={bulkSubmitting}>
              Cancel
            </EButton>
            <EButton variant="gold" onClick={submitBulkStatus} disabled={bulkSubmitting}>
              {bulkSubmitting ? "Applying…" : "Update status"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
