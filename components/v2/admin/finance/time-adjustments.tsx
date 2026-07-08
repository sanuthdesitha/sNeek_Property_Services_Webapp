"use client";

/**
 * ESTATE clock / time adjustments — v2-native browsing workspace for the v1
 * ClockAdjustmentsWorkspace data (cleaner requests to change the final clock
 * time captured at submission).
 *
 * Endpoints (unchanged from v1):
 *   list → GET /api/admin/time-adjustments            (rows include original vs
 *          requested clock-out, totals and the minimum approvable duration)
 *
 * Approve / reject of PENDING requests is NOT duplicated here — those
 * mutations live in the v2 Approval Center ("Clock" queue), which PATCHes
 * /api/admin/time-adjustments/[id]. Pending rows link across instead.
 * The v1 API has no admin manual time-log (start/stop) edit endpoint, so no
 * manual edit surface exists here either.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowUpRight, Clock3, RefreshCw } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState, EEyebrow } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";

type TimeAdjustmentStatus = "PENDING" | "APPROVED" | "REJECTED";

type TimeAdjustmentRow = {
  id: string;
  status: TimeAdjustmentStatus;
  requestedDurationM: number;
  requestedStoppedAt: string | null;
  originalDurationM: number;
  originalStoppedAt: string | null;
  reason: string | null;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  minimumApprovableDurationM: number;
  originalTotalDurationM: number;
  requestedTotalDurationM: number;
  cleaner: { id: string; name: string | null; email: string };
  reviewedBy: { id: string; name: string | null; email: string } | null;
  job: {
    id: string;
    jobNumber: string;
    jobType: string;
    scheduledDate: string;
    property: { id: string; name: string; suburb: string };
  };
  timeLog: {
    id: string;
    startedAt: string;
    stoppedAt: string | null;
    durationM: number | null;
  };
};

const STATUS_TONE: Record<TimeAdjustmentStatus, "warning" | "success" | "danger"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

function formatMinutes(minutes: number | null | undefined) {
  const safeMinutes = Math.max(0, Number(minutes ?? 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours <= 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function fmtAt(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : format(parsed, "dd MMM yyyy HH:mm");
}

function fmtDay(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : format(parsed, "dd MMM yyyy");
}

export function EstateTimeAdjustments() {
  const [rows, setRows] = useState<TimeAdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters — all applied client-side (the API only filters by status).
  const [tab, setTab] = useState<TimeAdjustmentStatus | "ALL">("PENDING");
  const [cleanerId, setCleanerId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/time-adjustments", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setRows(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const cleaners = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const row of rows) {
      if (!byId.has(row.cleaner.id)) {
        byId.set(row.cleaner.id, {
          id: row.cleaner.id,
          label: row.cleaner.name?.trim() || row.cleaner.email,
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const pendingCount = useMemo(() => rows.filter((row) => row.status === "PENDING").length, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab !== "ALL" && row.status !== tab) return false;
      if (cleanerId && row.cleaner.id !== cleanerId) return false;
      const jobDay = new Date(row.job.scheduledDate);
      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`);
        if (!Number.isNaN(from.getTime()) && jobDay < from) return false;
      }
      if (toDate) {
        const to = new Date(`${toDate}T23:59:59.999`);
        if (!Number.isNaN(to.getTime()) && jobDay > to) return false;
      }
      return true;
    });
  }, [rows, tab, cleanerId, fromDate, toDate]);

  const TABS: Array<{ id: typeof tab; label: string }> = [
    { id: "PENDING", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { id: "APPROVED", label: "Approved" },
    { id: "REJECTED", label: "Rejected" },
    { id: "ALL", label: "All" },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar: status tabs + refresh + approvals link */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={
                "rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] " +
                (tab === t.id
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <EButton variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </EButton>
          <EButton variant="outline" size="sm" asChild>
            <Link href="/v2/admin/approvals">
              <ArrowUpRight className="h-3.5 w-3.5" />
              Approval Center
            </Link>
          </EButton>
        </div>
      </div>

      {/* Filters */}
      <ECard className="px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <EField label="Cleaner">
            <ESelect value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
              <option value="">All cleaners</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Job date from">
            <EInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </EField>
          <EField label="Job date to">
            <EInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </EField>
        </div>
      </ECard>

      {loading ? (
        <ECard className="px-6 py-14 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading clock adjustments…
        </ECard>
      ) : filtered.length === 0 ? (
        <EEmptyState
          eyebrow="Time"
          title="Nothing here"
          description={
            tab === "PENDING"
              ? "No clock adjustment requests are waiting for review."
              : "No clock adjustment requests match these filters."
          }
        />
      ) : (
        <ECard className="overflow-hidden">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {filtered.map((row) => {
              const delta = row.requestedTotalDurationM - row.originalTotalDurationM;
              const deltaSign = delta > 0 ? "+" : delta < 0 ? "-" : "";
              const cleanerName = row.cleaner.name?.trim() || row.cleaner.email;
              return (
                <div key={row.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Clock3 className="h-4 w-4 shrink-0 text-[hsl(var(--e-gold))]" />
                        <Link
                          href={`/v2/admin/jobs/${row.job.id}`}
                          className="font-[550] hover:underline"
                        >
                          {row.job.property.name}
                        </Link>
                        <EBadge tone="neutral" soft>{row.job.jobNumber}</EBadge>
                        <EBadge tone={STATUS_TONE[row.status]} soft>{row.status}</EBadge>
                      </div>
                      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                        {cleanerName} · {row.job.property.suburb} ·{" "}
                        {row.job.jobType.replace(/_/g, " ")} · {fmtDay(row.job.scheduledDate)}
                      </p>
                      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                        Requested {fmtAt(row.createdAt)}
                        {row.reviewedAt
                          ? ` · Reviewed ${fmtAt(row.reviewedAt)}${
                              row.reviewedBy
                                ? ` by ${row.reviewedBy.name?.trim() || row.reviewedBy.email}`
                                : ""
                            }`
                          : ""}
                      </p>
                    </div>
                    {row.status === "PENDING" ? (
                      <EButton size="sm" variant="gold" asChild>
                        <Link href="/v2/admin/approvals">
                          Review in Approvals
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </EButton>
                    ) : null}
                  </div>

                  {/* Side-by-side before / after */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] p-3">
                      <EEyebrow>Original</EEyebrow>
                      <dl className="mt-2 space-y-1 text-[0.8125rem]">
                        <div className="flex justify-between gap-3">
                          <dt className="text-[hsl(var(--e-muted-foreground))]">Clock-in</dt>
                          <dd className="font-[550]">{fmtAt(row.timeLog.startedAt)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-[hsl(var(--e-muted-foreground))]">Clock-out</dt>
                          <dd className="font-[550]">{fmtAt(row.originalStoppedAt)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-[hsl(var(--e-muted-foreground))]">Total time</dt>
                          <dd className="font-[550]">{formatMinutes(row.originalTotalDurationM)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-gold-soft))] p-3">
                      <EEyebrow>Requested</EEyebrow>
                      <dl className="mt-2 space-y-1 text-[0.8125rem]">
                        <div className="flex justify-between gap-3">
                          <dt className="text-[hsl(var(--e-muted-foreground))]">Clock-in</dt>
                          <dd className="font-[550]">{fmtAt(row.timeLog.startedAt)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-[hsl(var(--e-muted-foreground))]">Clock-out</dt>
                          <dd className="font-[550]">{fmtAt(row.requestedStoppedAt)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-[hsl(var(--e-muted-foreground))]">Total time</dt>
                          <dd className="font-[550]">
                            {formatMinutes(row.requestedTotalDurationM)}
                            {delta !== 0 ? (
                              <span
                                className={
                                  "ml-2 text-[0.75rem] font-semibold " +
                                  (delta > 0
                                    ? "text-[hsl(var(--e-success))]"
                                    : "text-[hsl(var(--e-danger))]")
                                }
                              >
                                {deltaSign}
                                {formatMinutes(Math.abs(delta))}
                              </span>
                            ) : null}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  {row.reason ? (
                    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                      <EEyebrow>Reason from cleaner</EEyebrow>
                      <p className="mt-1 text-[0.8125rem]">{row.reason}</p>
                    </div>
                  ) : null}
                  {row.adminNote ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      Admin note: {row.adminNote}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </ECard>
      )}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Approving a request rewrites the final time-log segment (clock-out + duration); rejected
        requests leave the original clock untouched. Decisions happen in the Approval Center.
      </p>
    </div>
  );
}
