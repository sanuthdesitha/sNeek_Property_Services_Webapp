"use client";

/**
 * ESTATE v2 — QA queue workspace.
 *
 * Native Estate rebuild of the QA queue — the inspector's "Today" list.
 *   GET  /api/qa/queue?scope=active|completed&date=today|tomorrow|YYYY-MM-DD
 *                     &assignedOnly=1
 *   POST /api/qa/jobs/[id]/pickup
 *   POST  /api/admin/qa/assignments        (assign — bulk or one-by-one, OPS/ADMIN)
 *   PATCH /api/admin/qa/assignments/[id]   (reassign an inspector, OPS/ADMIN)
 *   GET   /api/qa/jobs/[id]/progress       (live EST finish for unfinished cleans)
 *
 * Jobs can be handed out BEFORE the cleaner submits — rows carry
 * `inspectionReadiness` ("CLEANING" | "READY" | "REWORK_PENDING") and unfinished
 * rows show the live on-site time + EST finish so an inspector can plan travel.
 *
 * Rows arrive already ordered by the server (sequence ASC NULLS LAST →
 * scheduledFor → dueAt), so the list renders the inspector's planned visit order
 * top to bottom. Each card shows the visit number, property, cleaner, the job's
 * live state (cleaning / submitted / form pending) and the scheduled slot.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EStatCard } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";

type Inspector = { id: string; name: string | null; email: string; role: string };
type Toast = { id: string; title: string; description?: string; tone: "info" | "danger" };

function titleCase(value: string): string {
  return String(value)
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function jobTitle(job: any) {
  return `${job?.property?.name ?? "Property"} — ${titleCase(String(job?.jobType ?? "Job"))}`;
}
function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "COMPLETED") return "success";
  if (status === "QA_REVIEW") return "warning";
  return "neutral";
}

/** The job's live state as the inspector cares about it. */
function jobStateChip(job: any): { label: string; tone: "success" | "warning" | "info" | "neutral" } {
  if (job?.formPendingAfterClockOut) return { label: "Form pending", tone: "warning" };
  const status = String(job?.status ?? "");
  if (status === "IN_PROGRESS") return { label: "Cleaning now", tone: "info" };
  if (status === "SUBMITTED" || status === "QA_REVIEW") return { label: "Submitted", tone: "success" };
  if (status === "COMPLETED") return { label: "Completed", tone: "success" };
  return { label: titleCase(status || "Scheduled"), tone: "neutral" };
}

/**
 * Fallback readiness for a row. The server ships `inspectionReadiness` on every
 * row; this only covers a stale/cached payload from before that field existed.
 */
function readinessOf(job: any): "CLEANING" | "READY" | "REWORK_PENDING" {
  if (job?.inspectionReadiness) return job.inspectionReadiness;
  const status = String(job?.status ?? "").toUpperCase();
  if ((job?.formSubmissions?.length ?? 0) > 0) return "READY";
  if (["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(status)) return "READY";
  return job?.isRework ? "REWORK_PENDING" : "CLEANING";
}

function hhmm(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "1h 12m" / "48m" — null when we don't know. */
function durationLabel(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * "Wed 23 Jul" — the job's scheduled date, always shown on the row. The queue
 * spans multiple days (date-range filter), so a time-only slot is ambiguous
 * without it.
 */
function jobDateLabel(job: any): string | null {
  if (!job?.scheduledDate) return null;
  const d = new Date(job.scheduledDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Australia/Sydney",
  });
}

/** Planned slot for a row: the assignment's scheduledFor, else the job window. */
function slotLabel(assignment: any, job: any): string | null {
  if (assignment?.scheduledFor) {
    return new Date(assignment.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (job?.startTime) return String(job.startTime);
  if (assignment?.dueAt) {
    return `due ${new Date(assignment.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return null;
}

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function QaQueueWorkspace({ inspectors, canAssign = false }: { inspectors: Inspector[]; canAssign?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({ assignments: [], unassignedJobs: [] });
  const [scope, setScope] = useState<"active" | "completed">("active");
  // Day filter: today / tomorrow / a specific date / everything.
  const [dateMode, setDateMode] = useState<"today" | "tomorrow" | "custom" | "all">("today");
  const [customDate, setCustomDate] = useState<string>(() => todayIso());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedInspector, setSelectedInspector] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Per-row inline assign: keyed by jobId (assign) or assignmentId (reassign).
  const [rowInspector, setRowInspector] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  // Live clean progress for rows whose job is still being cleaned. Fetched once
  // per load (and on Refresh) — never polled here; polling belongs to the
  // inspection workspace where a single job is being watched.
  const [progressByJob, setProgressByJob] = useState<Record<string, any>>({});

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, []);

  const dateParam = useMemo(() => {
    if (dateMode === "all") return null;
    if (dateMode === "custom") return customDate || null;
    return dateMode;
  }, [dateMode, customDate]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ scope });
    if (dateParam) qs.set("date", dateParam);
    const res = await fetch(`/api/qa/queue?${qs.toString()}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      pushToast({ title: "Could not load QA queue", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    setData(body);
  }, [scope, dateParam, pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const assigned = (data.assignments ?? []).map((a: any) => ({ key: a.id, jobId: a.jobId, assignment: a, job: a.job, assigned: true }));
    const unassigned = (data.unassignedJobs ?? []).map((j: any) => ({ key: `job-${j.id}`, jobId: j.id, assignment: null, job: j, assigned: false }));
    return [...assigned, ...unassigned];
  }, [data]);

  /** Rows whose clean has NOT finished — the ones with a live EST finish. */
  const liveJobIds = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter((r) => (r.job?.inspectionReadiness ?? readinessOf(r.job)) !== "READY")
            .map((r) => r.jobId)
            .filter(Boolean),
        ),
      ),
    [rows],
  );

  // One batched fetch per queue load. Failures are silent — the live line is a
  // nicety, never a blocker for the queue itself.
  useEffect(() => {
    if (liveJobIds.length === 0) {
      setProgressByJob({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        liveJobIds.slice(0, 25).map(async (jobId) => {
          try {
            const res = await fetch(`/api/qa/jobs/${jobId}/progress`, { cache: "no-store" });
            if (!res.ok) return [jobId, null] as const;
            return [jobId, await res.json()] as const;
          } catch {
            return [jobId, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, any> = {};
      for (const [jobId, value] of entries) if (value) next[jobId] = value;
      setProgressByJob(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [liveJobIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobTypeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.job?.jobType && set.add(String(r.job.jobType)));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const job = row.job ?? {};
      if (typeFilter !== "all" && String(job.jobType) !== typeFilter) return false;
      if (q) {
        const hay = [job.property?.name, job.property?.address, job.property?.suburb, titleCase(String(job.jobType ?? ""))]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, typeFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const unassigned = rows.filter((r) => !r.assigned).length;
    const inProgress = rows.filter((r) => r.assignment?.pickedUpById || r.assignment?.status === "IN_PROGRESS").length;
    const assigned = Math.max(0, total - unassigned - inProgress);
    return { total, unassigned, assigned, inProgress };
  }, [rows]);

  async function bulkAssign() {
    if (!selectedInspector || selectedJobs.length === 0) return;
    const res = await fetch("/api/admin/qa/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: selectedJobs, assignedToId: selectedInspector }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast({ title: "QA assignment failed", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    pushToast({ title: "QA assigned", description: `${body.created ?? selectedJobs.length} job(s) assigned.`, tone: "info" });
    setSelectedJobs([]);
    await load();
  }

  /**
   * One-by-one assignment. The bulk control still exists for "give this
   * inspector the whole morning", but the common case is handing out a single
   * job — including a job that is still being CLEANED, so the inspector can
   * plan the drive and watch it land.
   */
  async function assignOne(jobId: string, inspectorId: string) {
    if (!inspectorId) return;
    setRowBusy((prev) => ({ ...prev, [jobId]: true }));
    const res = await fetch("/api/admin/qa/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: [jobId], assignedToId: inspectorId }),
    });
    const body = await res.json().catch(() => ({}));
    setRowBusy((prev) => ({ ...prev, [jobId]: false }));
    if (!res.ok) {
      pushToast({ title: "QA assignment failed", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    pushToast({ title: "Inspector assigned", tone: "info" });
    setRowInspector((prev) => ({ ...prev, [jobId]: "" }));
    await load();
  }

  /** Move an existing assignment to a different inspector. */
  async function reassign(assignmentId: string, inspectorId: string) {
    if (!inspectorId) return;
    setRowBusy((prev) => ({ ...prev, [assignmentId]: true }));
    const res = await fetch(`/api/admin/qa/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: inspectorId }),
    });
    const body = await res.json().catch(() => ({}));
    setRowBusy((prev) => ({ ...prev, [assignmentId]: false }));
    if (!res.ok) {
      pushToast({ title: "Reassign failed", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    pushToast({ title: "Inspector changed", tone: "info" });
    setRowInspector((prev) => ({ ...prev, [assignmentId]: "" }));
    await load();
  }

  async function pickup(jobId: string) {
    const res = await fetch(`/api/qa/jobs/${jobId}/pickup`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast({ title: "Could not pick up QA", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    pushToast({ title: "QA picked up", tone: "info" });
    await load();
  }

  return (
    <div className="space-y-6">
      {toasts.length > 0 ? (
        <div className="fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="w-full max-w-sm rounded-[var(--e-radius-lg)] border px-4 py-3 shadow-[var(--e-elevation-2)]"
              style={{
                backgroundColor: t.tone === "danger" ? "hsl(var(--e-danger-soft))" : "hsl(var(--e-surface))",
                borderColor: t.tone === "danger" ? "hsl(var(--e-danger))" : "hsl(var(--e-border-strong))",
              }}
            >
              <p className="text-[0.8125rem] font-semibold">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{t.description}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* scope toggle + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-0.5">
          {(["active", "completed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className="rounded-[var(--e-radius-pill)] px-4 py-1.5 text-[0.8125rem] font-[550] transition-colors"
              style={{
                backgroundColor: scope === s ? "hsl(var(--e-gold))" : "transparent",
                color: scope === s ? "hsl(var(--e-gold-foreground))" : "hsl(var(--e-muted-foreground))",
              }}
            >
              {s === "active" ? "To inspect" : "Submitted"}
            </button>
          ))}
        </div>
        <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
        </EButton>
      </div>

      {/* day filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["today", "Today"],
            ["tomorrow", "Tomorrow"],
            ["all", "All"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setDateMode(mode)}
            className="rounded-[var(--e-radius-pill)] border px-3.5 py-1.5 text-[0.8125rem] font-[550] transition-colors"
            style={{
              backgroundColor: dateMode === mode ? "hsl(var(--e-gold-soft))" : "hsl(var(--e-surface))",
              borderColor: dateMode === mode ? "hsl(var(--e-gold))" : "hsl(var(--e-border))",
              color: dateMode === mode ? "hsl(var(--e-gold-ink))" : "hsl(var(--e-muted-foreground))",
            }}
          >
            {label}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
          <EInput
            type="date"
            className="h-9 w-[10.5rem]"
            value={customDate}
            onChange={(e) => {
              setCustomDate(e.target.value);
              setDateMode("custom");
            }}
            aria-label="Inspect a specific date"
          />
        </div>
      </div>

      {!loading ? (
        <section className="grid gap-4 sm:grid-cols-4">
          <EStatCard label="In queue" value={String(stats.total)} delta="total" deltaTone="neutral" icon={<Inbox className="h-4 w-4" />} />
          <EStatCard label="Unassigned" value={String(stats.unassigned)} delta="unpicked" deltaTone="neutral" icon={<ClipboardCheck className="h-4 w-4" />} />
          <EStatCard label="Assigned" value={String(stats.assigned)} delta="waiting" deltaTone="neutral" icon={<UserCheck className="h-4 w-4" />} />
          <EStatCard label="In progress" value={String(stats.inProgress)} delta="being inspected" deltaTone="neutral" icon={<Loader2 className="h-4 w-4" />} />
        </section>
      ) : null}

      {canAssign ? (
        <ECard>
          <ECardBody className="grid gap-3 pt-6 sm:grid-cols-[1fr_auto]">
            <ESelect value={selectedInspector} onChange={(e) => setSelectedInspector(e.target.value)}>
              <option value="">Select QA inspector or OPS manager</option>
              {inspectors.map((i) => (
                <option key={i.id} value={i.id}>{(i.name || i.email) + ` (${titleCase(i.role)})`}</option>
              ))}
            </ESelect>
            <EButton onClick={() => void bulkAssign()} disabled={!selectedInspector || selectedJobs.length === 0}>
              <UserPlus className="h-4 w-4" /> Assign {selectedJobs.length || ""}
            </EButton>
          </ECardBody>
        </ECard>
      ) : null}

      {/* filters */}
      <ECard>
        <ECardBody className="grid gap-2 pt-6 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
            <EInput className="pl-9" placeholder="Search property…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ESelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {jobTypeOptions.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </ESelect>
        </ECardBody>
      </ECard>

      {/* list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-6 py-12 text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
          </div>
        ) : rows.length === 0 ? (
          <EEmptyState eyebrow="All clear" title="No jobs waiting" description="Every submitted job has been reviewed." />
        ) : filtered.length === 0 ? (
          <EEmptyState eyebrow="No match" title="Nothing matches these filters" />
        ) : (
          filtered.map((row, index) => {
            const state = jobStateChip(row.job);
            const slot = slotLabel(row.assignment, row.job);
            const jobDate = jobDateLabel(row.job);
            const seq = row.assignment?.sequence ?? null;
            const readiness = readinessOf(row.job);
            const progress = progressByJob[row.jobId] ?? null;
            const estFinish = hhmm(progress?.estFinishAt);
            const onSite = durationLabel(progress?.elapsedMinutes);
            const rowKeyForAssign = row.assigned ? row.assignment.id : row.jobId;
            const busy = Boolean(rowBusy[rowKeyForAssign]);
            return (
            <ECard key={row.key}>
              <ECardBody className="flex flex-wrap items-center gap-3 pt-6">
                {/* visit order — the server already sorted; this is the position */}
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-bold"
                  style={{
                    backgroundColor: seq ? "hsl(var(--e-gold))" : "hsl(var(--e-surface-raised))",
                    color: seq ? "hsl(var(--e-gold-foreground))" : "hsl(var(--e-muted-foreground))",
                    border: seq ? "none" : "1px solid hsl(var(--e-border-strong))",
                  }}
                  title={seq ? `Visit ${seq}` : "Unordered"}
                >
                  {seq ?? index + 1}
                </span>
                {canAssign && !row.assigned ? (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                    checked={selectedJobs.includes(row.jobId)}
                    onChange={(e) => setSelectedJobs((prev) => (e.target.checked ? [...prev, row.jobId] : prev.filter((id) => id !== row.jobId)))}
                    aria-label={`Select ${jobTitle(row.job)}`}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[0.9375rem] font-medium">{jobTitle(row.job)}</p>
                    <EBadge tone={state.tone} soft>{state.label}</EBadge>
                    <EBadge tone={row.assigned ? "info" : "neutral"} soft>
                      {row.assigned ? titleCase(String(row.assignment.status)) : "Unassigned"}
                    </EBadge>
                    {row.assignment?.checkInAt ? (
                      <EBadge tone="success" soft>Checked in</EBadge>
                    ) : null}
                    {readiness !== "READY" ? (
                      <EBadge tone="warning" soft>
                        {readiness === "REWORK_PENDING" ? "Rework in progress" : "Not submitted yet"}
                      </EBadge>
                    ) : null}
                    {progress?.runningOver ? <EBadge tone="danger" soft>Running over</EBadge> : null}
                    {row.assignment?.reworkOfferStatus && row.assignment.reworkOfferStatus !== "NONE" ? (
                      <EBadge tone={row.assignment.reworkOfferStatus === "ACCEPTED" ? "success" : "warning"} soft>
                        Rework {titleCase(String(row.assignment.reworkOfferStatus))}
                      </EBadge>
                    ) : null}
                  </div>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {[row.job?.property?.address, row.job?.property?.suburb].filter(Boolean).join(", ")}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    {jobDate ? <span className="tabular-nums font-[550] text-[hsl(var(--e-text-secondary))]">{jobDate}</span> : null}
                    {slot ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> {slot}
                      </span>
                    ) : null}
                    <span>
                      Cleaner: {row.job?.assignments?.map((a: any) => a.user?.name || a.user?.email).join(", ") || "N/A"}
                    </span>
                    {row.assignment?.assignedTo ? (
                      <span>· QA {row.assignment.assignedTo.name || row.assignment.assignedTo.email}</span>
                    ) : null}
                  </p>
                  {/* live clean progress — only for jobs that haven't submitted */}
                  {readiness !== "READY" && (estFinish || onSite) ? (
                    <p
                      className="flex flex-wrap items-center gap-x-2 text-[0.75rem] font-[550]"
                      style={{ color: progress?.runningOver ? "hsl(var(--e-danger))" : "hsl(var(--e-text-secondary))" }}
                    >
                      {onSite ? <span>On site {onSite}</span> : null}
                      {estFinish ? <span>· EST finish {estFinish}</span> : null}
                      {progress?.checklist ? <span>· checklist {progress.checklist.percent}%</span> : null}
                    </p>
                  ) : null}
                  {/* inline one-by-one assign / reassign (OPS + ADMIN only) */}
                  {canAssign && scope === "active" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ESelect
                        className="h-8 w-[15rem] text-[0.75rem]"
                        value={rowInspector[rowKeyForAssign] ?? ""}
                        onChange={(e) =>
                          setRowInspector((prev) => ({ ...prev, [rowKeyForAssign]: e.target.value }))
                        }
                        aria-label={`${row.assigned ? "Reassign" : "Assign"} ${jobTitle(row.job)}`}
                      >
                        <option value="">{row.assigned ? "Move to inspector…" : "Assign inspector…"}</option>
                        {inspectors.map((i) => (
                          <option key={i.id} value={i.id}>
                            {(i.name || i.email) + ` (${titleCase(i.role)})`}
                          </option>
                        ))}
                      </ESelect>
                      <EButton
                        variant="outline"
                        size="sm"
                        disabled={busy || !rowInspector[rowKeyForAssign]}
                        onClick={() =>
                          row.assigned
                            ? void reassign(row.assignment.id, rowInspector[rowKeyForAssign] ?? "")
                            : void assignOne(row.jobId, rowInspector[rowKeyForAssign] ?? "")
                        }
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                        {row.assigned ? "Reassign" : "Assign"}
                      </EButton>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!row.assignment?.pickedUpById && scope === "active" ? (
                    <EButton variant="outline" size="sm" onClick={() => void pickup(row.jobId)}>
                      <ClipboardCheck className="h-4 w-4" /> Pick up
                    </EButton>
                  ) : null}
                  <EButton asChild variant="gold" size="sm">
                    <Link href={`/v2/qa/jobs/${row.jobId}`}>
                      {readiness !== "READY"
                        ? "Monitor clean"
                        : row.assignment?.status === "IN_PROGRESS"
                          ? "Continue inspection"
                          : "Start inspection"}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </EButton>
                </div>
              </ECardBody>
            </ECard>
            );
          })
        )}
      </div>
    </div>
  );
}
