"use client";

/**
 * Estate client "Services" agenda.
 *
 * Day-by-day (Australia/Sydney) agenda of every service across the client's
 * properties, with client-appropriate filters. Day grouping + labels come from
 * the SHARED `groupJobsBySydneyDay` helper the admin jobs list uses, so both
 * surfaces name days identically ("Today · Fri 1 Aug", "Tomorrow · Sat 2 Aug",
 * otherwise "Sat 2 Aug").
 *
 * The whole list is already loaded by the server page, so every filter is
 * client-side and instant — no refetch, no pagination params.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight, SlidersHorizontal } from "lucide-react";

import { groupJobsBySydneyDay } from "@/lib/jobs/date-grouping";
import {
  addDaysToKey,
  monthEndKey,
  monthStartKey,
  sydneyDateKey,
  sydneyTodayKey,
  weekMondayKey,
} from "@/lib/time/sydney-range";
import { EBadge, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { ELabel, ESelect } from "@/components/v2/client/fields";

export type ServiceRow = {
  id: string;
  jobType: string;
  status: string;
  /** ISO string — serialised by the server page so SSR and hydration agree. */
  scheduledDate: string;
  startTime: string | null;
  property: { id: string; name: string };
  cleanerName: string | null;
};

type DateScope = "upcoming" | "week" | "month" | "past" | "all";
type StatusBucket = "all" | "scheduled" | "in_progress" | "completed";

const DATE_SCOPES: { id: DateScope; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
];

const STATUS_BUCKETS: { id: StatusBucket; label: string; statuses: string[] }[] = [
  { id: "all", label: "All statuses", statuses: [] },
  { id: "scheduled", label: "Scheduled", statuses: ["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE"] },
  {
    id: "in_progress",
    label: "In progress",
    statuses: ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW"],
  },
  { id: "completed", label: "Completed", statuses: ["COMPLETED", "INVOICED"] },
];

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(status: string): Tone {
  switch (status) {
    case "COMPLETED":
    case "INVOICED":
      return "success";
    case "QA_REVIEW":
      return "aubergine";
    case "EN_ROUTE":
    case "IN_PROGRESS":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "info";
    case "UNASSIGNED":
    case "OFFERED":
    case "SUBMITTED":
      return "warning";
    default:
      return "primary";
  }
}

/** Inclusive [from, to] Sydney day-key window for a scope; null = unbounded. */
function scopeWindow(scope: DateScope, todayKey: string): { from: string | null; to: string | null } {
  switch (scope) {
    case "upcoming":
      return { from: todayKey, to: null };
    case "week": {
      const monday = weekMondayKey(todayKey);
      return { from: monday, to: addDaysToKey(monday, 6) };
    }
    case "month":
      return { from: monthStartKey(todayKey), to: monthEndKey(todayKey) };
    case "past":
      return { from: null, to: addDaysToKey(todayKey, -1) };
    default:
      return { from: null, to: null };
  }
}

const CHIP_BASE =
  "whitespace-nowrap rounded-[var(--e-radius-sm)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms]";

export function ClientServicesAgenda({ jobs, nowIso }: { jobs: ServiceRow[]; nowIso: string }) {
  const now = React.useMemo(() => new Date(nowIso), [nowIso]);
  const todayKey = React.useMemo(() => sydneyTodayKey(now), [now]);

  const [dateScope, setDateScope] = React.useState<DateScope>("upcoming");
  const [propertyId, setPropertyId] = React.useState("all");
  const [jobType, setJobType] = React.useState("all");
  const [statusBucket, setStatusBucket] = React.useState<StatusBucket>("all");
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  // Day key per job, computed once — every filter and the grouping reuse it.
  const rows = React.useMemo(
    () => jobs.map((job) => ({ job, dayKey: sydneyDateKey(new Date(job.scheduledDate)) })),
    [jobs]
  );

  const properties = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const { job } of rows) if (!seen.has(job.property.id)) seen.set(job.property.id, job.property.name);
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const jobTypes = React.useMemo(
    () => Array.from(new Set(rows.map(({ job }) => job.jobType))).sort(),
    [rows]
  );

  const filtered = React.useMemo(() => {
    const { from, to } = scopeWindow(dateScope, todayKey);
    const statuses = STATUS_BUCKETS.find((bucket) => bucket.id === statusBucket)?.statuses ?? [];

    const kept = rows.filter(({ job, dayKey }) => {
      if (from && dayKey < from) return false;
      if (to && dayKey > to) return false;
      if (propertyId !== "all" && job.property.id !== propertyId) return false;
      if (jobType !== "all" && job.jobType !== jobType) return false;
      if (statuses.length > 0 && !statuses.includes(job.status)) return false;
      return true;
    });

    // Past reads newest-first; every forward-looking scope reads soonest-first.
    const dir = dateScope === "past" ? -1 : 1;
    return kept
      .sort((a, b) => {
        if (a.dayKey !== b.dayKey) return a.dayKey < b.dayKey ? -dir : dir;
        return (a.job.startTime ?? "").localeCompare(b.job.startTime ?? "") * dir;
      })
      .map(({ job }) => job);
  }, [rows, dateScope, propertyId, jobType, statusBucket, todayKey]);

  const groups = React.useMemo(() => groupJobsBySydneyDay(filtered, now), [filtered, now]);

  const refinedCount =
    (propertyId !== "all" ? 1 : 0) + (jobType !== "all" ? 1 : 0) + (statusBucket !== "all" ? 1 : 0);
  const hasActiveFilters = refinedCount > 0 || dateScope !== "upcoming";

  function clearFilters() {
    setDateScope("upcoming");
    setPropertyId("all");
    setJobType("all");
    setStatusBucket("all");
  }

  return (
    <div className="space-y-4">
      {/* ── Date scope — horizontally scrollable so all five fit at 375px ── */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex items-center gap-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-1">
          {DATE_SCOPES.map((scope) => (
            <button
              key={scope.id}
              type="button"
              aria-pressed={dateScope === scope.id}
              onClick={() => setDateScope(scope.id)}
              className={
                CHIP_BASE +
                " " +
                (dateScope === scope.id
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Refine row: mobile toggle + live count ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className="flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-3 py-1.5 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))] lg:hidden"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {refinedCount > 0 ? (
            <span className="e-numeral rounded-full bg-[hsl(var(--e-gold-soft))] px-1.5 text-[0.625rem] text-[hsl(var(--e-gold-ink))]">
              {refinedCount}
            </span>
          ) : null}
        </button>
        <span className="ml-auto text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="e-numeral text-[0.9375rem] text-[hsl(var(--e-foreground))]">{filtered.length}</span>{" "}
          service{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Panel: toggled on mobile, always open from lg up (pure CSS — no
          matchMedia, so there is nothing to mismatch at hydration). */}
      <div
        className={
          (filtersOpen ? "grid" : "hidden lg:grid") +
          " gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised)/0.5)] px-4 py-3 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {properties.length > 1 ? (
          <label className="flex flex-col gap-1">
            <ELabel>Property</ELabel>
            <ESelect
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
              aria-label="Filter by property"
            >
              <option value="all">All properties</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </ESelect>
          </label>
        ) : null}

        <label className="flex flex-col gap-1">
          <ELabel>Service</ELabel>
          <ESelect
            value={jobType}
            onChange={(event) => setJobType(event.target.value)}
            aria-label="Filter by service type"
          >
            <option value="all">All services</option>
            {jobTypes.map((type) => (
              <option key={type} value={type}>
                {titleCase(type)}
              </option>
            ))}
          </ESelect>
        </label>

        <label className="flex flex-col gap-1">
          <ELabel>Status</ELabel>
          <ESelect
            value={statusBucket}
            onChange={(event) => setStatusBucket(event.target.value as StatusBucket)}
            aria-label="Filter by status"
          >
            {STATUS_BUCKETS.map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.label}
              </option>
            ))}
          </ESelect>
        </label>
      </div>

      {/* ── Agenda ── */}
      {groups.length === 0 ? (
        <EEmptyState
          eyebrow={hasActiveFilters ? "No matches" : "All quiet"}
          title={hasActiveFilters ? "No services match these filters" : "No services yet"}
          description={
            hasActiveFilters
              ? "Try a wider date range, or clear the filters to see everything."
              : "Scheduled services across your properties will appear here."
          }
          action={
            hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-4 py-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] transition-colors duration-[160ms] hover:border-[hsl(var(--e-gold))]"
              >
                Clear filters
              </button>
            ) : null
          }
        />
      ) : (
        <ECard className="overflow-hidden">
          {groups.map((group) => (
            <div key={group.dayKey}>
              {/* Sticky agenda day header — same language + shape as the admin
                  jobs list; offset by the portal's 4rem sticky app header. */}
              <div className="sticky top-16 z-10 flex items-center gap-2.5 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2 sm:px-5">
                <span className="truncate text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-secondary))]">
                  {group.label}
                </span>
                <span className="e-numeral rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))] px-2 py-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                  {group.jobs.length}
                </span>
              </div>
              <div className="divide-y divide-[hsl(var(--e-border))]">
                {group.jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/v2/client/jobs/${job.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors duration-[160ms] hover:bg-[hsl(var(--e-muted)/0.4)] sm:px-5"
                  >
                    <span className="e-numeral w-12 flex-shrink-0 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      {job.startTime ?? "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-[550]">{job.property.name}</p>
                      <p className="truncate text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                        {titleCase(job.jobType)}
                        {job.cleanerName ? ` · ${job.cleanerName}` : ""}
                        {/* Narrow screens hide the badge — keep the status legible here. */}
                        <span className="sm:hidden"> · {titleCase(job.status)}</span>
                      </p>
                    </div>
                    <EBadge tone={statusTone(job.status)} soft className="hidden sm:inline-flex">
                      {titleCase(job.status)}
                    </EBadge>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-[hsl(var(--e-text-faint))]" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </ECard>
      )}
    </div>
  );
}
