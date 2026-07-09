"use client";

/**
 * ESTATE schedule — a custom month grid + agenda list built on CSS grid.
 * No FullCalendar. Same data as the legacy dispatch calendar: /api/jobs for
 * jobs and /api/admin/laundry/calendar for the optional laundry overlay.
 * Chips link to /v2/admin/jobs/[id]; drag-reschedule stays in the classic
 * dispatch calendar (linked from the page header).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, Shirt, User2, UserPlus } from "lucide-react";
import { EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import {
  AssignCleanersModal,
  type AssignCleaner,
} from "@/components/v2/admin/jobs/assign-cleaners-modal";

const SYDNEY_TZ = "Australia/Sydney";

/* Job status → Estate token + label (mirrors the legacy palette semantics). */
const STATUS_META: Record<string, { color: string; label: string }> = {
  UNASSIGNED: { color: "hsl(var(--e-warning))", label: "Unassigned" },
  OFFERED: { color: "hsl(var(--e-warning))", label: "Awaiting confirmation" },
  ASSIGNED: { color: "hsl(var(--e-accent-portal))", label: "Assigned" },
  EN_ROUTE: { color: "hsl(var(--e-info))", label: "En route" },
  IN_PROGRESS: { color: "hsl(var(--e-info))", label: "In progress" },
  PAUSED: { color: "hsl(var(--e-warning))", label: "Paused" },
  WAITING_CONTINUATION_APPROVAL: { color: "hsl(var(--e-danger))", label: "Waiting approval" },
  SUBMITTED: { color: "hsl(284 22% 44%)", label: "Submitted" },
  QA_REVIEW: { color: "hsl(284 22% 44%)", label: "QA review" },
  COMPLETED: { color: "hsl(var(--e-success))", label: "Completed" },
  INVOICED: { color: "hsl(var(--e-muted-foreground))", label: "Invoiced" },
};
const FALLBACK_META = { color: "hsl(var(--e-accent-portal))", label: "Scheduled" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type JobEntry = {
  id: string;
  status: string;
  day: string; // yyyy-MM-dd
  startTime?: string | null;
  scheduledDate: string;
  propertyName: string;
  suburb: string;
  jobType: string;
  jobTypeLabel: string;
  cleanerName?: string;
  assignedIds: string[];
  primaryId: string | null;
};

type LaundryEntry = {
  id: string;
  status: string;
  day: string;
  kind: "pickup" | "dropoff";
  propertyName: string;
};

function sydneyTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isoDay(value: string) {
  return String(value).slice(0, 10);
}

function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function cleanerLabel(job: any): string | undefined {
  const names: string[] = Array.isArray(job?.assignments)
    ? job.assignments.map((a: any) => a?.user?.name).filter(Boolean)
    : [];
  if (names.length === 0) return undefined;
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

export function EstateSchedule() {
  const todayIso = useMemo(() => sydneyTodayIso(), []);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [cursor, setCursor] = useState(() => ({
    year: Number(todayIso.slice(0, 4)),
    month: Number(todayIso.slice(5, 7)) - 1,
  }));
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [showLaundry, setShowLaundry] = useState(false);
  const [laundry, setLaundry] = useState<LaundryEntry[]>([]);
  const [laundryLoadedKey, setLaundryLoadedKey] = useState("");
  const [cleaners, setCleaners] = useState<AssignCleaner[]>([]);
  const [assignJob, setAssignJob] = useState<JobEntry | null>(null);

  function loadJobs() {
    setLoading(true);
    fetch("/api/jobs", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: any[]) => {
        if (!Array.isArray(data)) {
          setJobs([]);
          return;
        }
        setJobs(
          data.map((job) => {
            const assignments = Array.isArray(job?.assignments) ? job.assignments : [];
            return {
              id: job.id,
              status: String(job.status ?? ""),
              day: isoDay(job.scheduledDate),
              startTime: job.startTime ?? null,
              scheduledDate: String(job.scheduledDate ?? ""),
              propertyName: job.property?.name ?? "Property",
              suburb: job.property?.suburb ?? "",
              jobType: String(job.jobType ?? ""),
              jobTypeLabel: String(job.jobType ?? "").replace(/_/g, " "),
              cleanerName: cleanerLabel(job),
              assignedIds: assignments.map((a: any) => String(a?.user?.id ?? a?.userId ?? "")).filter(Boolean),
              primaryId:
                assignments.find((a: any) => a?.isPrimary)?.user?.id ??
                assignments.find((a: any) => a?.isPrimary)?.userId ??
                null,
            };
          })
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadJobs();
  }, []);

  /* Active cleaner accounts for the assign popover. */
  useEffect(() => {
    fetch("/api/admin/users?role=CLEANER")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next: AssignCleaner[] = Array.isArray(rows)
          ? rows
              .map((row: any) => ({
                id: String(row.id ?? ""),
                name: String(row.name ?? row.email ?? "").trim(),
                email: String(row.email ?? "").trim(),
              }))
              .filter((row: AssignCleaner) => row.id)
          : [];
        setCleaners(next);
      })
      .catch(() => setCleaners([]));
  }, []);

  /* Laundry overlay — same /api/admin/laundry/calendar source as v1. */
  const monthKey = `${cursor.year}-${pad(cursor.month + 1)}`;
  useEffect(() => {
    if (!showLaundry || laundryLoadedKey === monthKey) return;
    const start = `${monthKey}-01T00:00:00.000Z`;
    const endMonth = cursor.month === 11 ? { y: cursor.year + 1, m: 0 } : { y: cursor.year, m: cursor.month + 1 };
    const end = `${endMonth.y}-${pad(endMonth.m + 1)}-01T00:00:00.000Z`;
    fetch(`/api/admin/laundry/calendar?start=${start}&end=${end}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: any[]) => {
        if (!Array.isArray(data)) {
          setLaundry([]);
          return;
        }
        const entries: LaundryEntry[] = [];
        for (const task of data) {
          const name = task?.property?.name ?? "Laundry";
          if (task.pickupDate) {
            entries.push({ id: `${task.id}-p`, status: String(task.status), day: isoDay(task.pickupDate), kind: "pickup", propertyName: name });
          }
          if (task.dropoffDate) {
            entries.push({ id: `${task.id}-d`, status: String(task.status), day: isoDay(task.dropoffDate), kind: "dropoff", propertyName: name });
          }
        }
        setLaundry(entries);
        setLaundryLoadedKey(monthKey);
      })
      .catch(() => setLaundry([]));
  }, [showLaundry, monthKey, laundryLoadedKey, cursor]);

  const counts = useMemo(() => {
    return jobs.reduce<Record<string, number>>((acc, job) => {
      acc[job.status] = (acc[job.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [jobs]);

  const unassignedCount = useMemo(() => jobs.filter((job) => job.assignedIds.length === 0).length, [jobs]);

  const visibleJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          (statusFilter === "ALL" || job.status === statusFilter) &&
          (!unassignedOnly || job.assignedIds.length === 0)
      ),
    [jobs, statusFilter, unassignedOnly]
  );

  const jobsByDay = useMemo(() => {
    const map = new Map<string, JobEntry[]>();
    for (const job of visibleJobs) {
      if (!map.has(job.day)) map.set(job.day, []);
      map.get(job.day)!.push(job);
    }
    for (const list of Array.from(map.values())) {
      list.sort((a: JobEntry, b: JobEntry) => String(a.startTime ?? "99").localeCompare(String(b.startTime ?? "99")));
    }
    return map;
  }, [visibleJobs]);

  const laundryByDay = useMemo(() => {
    const map = new Map<string, LaundryEntry[]>();
    if (!showLaundry) return map;
    for (const entry of laundry) {
      if (!map.has(entry.day)) map.set(entry.day, []);
      map.get(entry.day)!.push(entry);
    }
    return map;
  }, [laundry, showLaundry]);

  /* Month grid cells: Monday-start, leading/trailing blanks. */
  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Mon = 0
    const list: Array<{ day: string; date: number } | null> = [];
    for (let i = 0; i < lead; i += 1) list.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      list.push({ day: `${cursor.year}-${pad(cursor.month + 1)}-${pad(d)}`, date: d });
    }
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [cursor]);

  /* Agenda: next 14 days grouped by day. */
  const agendaDays = useMemo(() => {
    const days: Array<{ day: string; label: string; jobs: JobEntry[] }> = [];
    const base = new Date(`${todayIso}T00:00:00`);
    for (let i = 0; i < 14; i += 1) {
      const date = new Date(base);
      date.setDate(base.getDate() + i);
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const dayJobs = jobsByDay.get(day) ?? [];
      if (dayJobs.length === 0) continue;
      days.push({
        day,
        label: date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }),
        jobs: dayJobs,
      });
    }
    return days;
  }, [jobsByDay, todayIso]);

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  const chipCls =
    "flex w-full items-center gap-1.5 rounded-[var(--e-radius-sm)] border px-1.5 py-1 text-left text-[0.6875rem] leading-tight transition-colors hover:bg-[hsl(var(--e-muted))]";

  return (
    <div className="space-y-4">
      {/* Legend / status filter */}
      <ECard className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={`inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.6875rem] font-[550] transition-colors ${
              statusFilter === "ALL"
                ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
            }`}
          >
            All ({jobs.length})
          </button>
          {Object.entries(STATUS_META).map(([status, meta]) =>
            (counts[status] ?? 0) > 0 || statusFilter === status ? (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter((current) => (current === status ? "ALL" : status))}
                className={`inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.6875rem] font-[550] transition-colors ${
                  statusFilter === status
                    ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                    : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
                {meta.label} ({counts[status] ?? 0})
              </button>
            ) : null
          )}
          <span className="mx-1 hidden h-4 w-px bg-[hsl(var(--e-border))] sm:block" aria-hidden />
          <button
            type="button"
            onClick={() => setUnassignedOnly((current) => !current)}
            className={`inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.6875rem] font-[550] transition-colors ${
              unassignedOnly
                ? "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]"
                : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
            }`}
          >
            <UserPlus className="h-3 w-3" aria-hidden />
            Unassigned ({unassignedCount})
          </button>
          <span className="mx-1 hidden h-4 w-px bg-[hsl(var(--e-border))] sm:block" aria-hidden />
          <button
            type="button"
            onClick={() => setShowLaundry((current) => !current)}
            className={`inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.6875rem] font-[550] transition-colors ${
              showLaundry
                ? "border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]"
                : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
            }`}
          >
            <Shirt className="h-3 w-3" aria-hidden />
            Laundry overlay
          </button>
        </div>
      </ECard>

      <ECard>
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-[hsl(var(--e-border))] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))]">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="flex h-8 w-8 items-center justify-center rounded-l-[var(--e-radius-pill)] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="flex h-8 w-8 items-center justify-center rounded-r-[var(--e-radius-pill)] border-l border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <EButton
              variant="outline"
              size="sm"
              onClick={() =>
                setCursor({ year: Number(todayIso.slice(0, 4)), month: Number(todayIso.slice(5, 7)) - 1 })
              }
            >
              Today
            </EButton>
            <p className="e-display-sm ml-1">{monthLabel(cursor.year, cursor.month)}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] p-0.5">
              {([
                ["month", "Month"],
                ["agenda", "Agenda"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setView(value)}
                  className={`rounded-[var(--e-radius-pill)] px-3 py-1 text-[0.75rem] font-[550] transition-colors ${
                    view === value
                      ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                      : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <EButton variant="ghost" size="sm" onClick={loadJobs} aria-label="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </EButton>
          </div>
        </div>

        {view === "month" ? (
          <div className="p-2 sm:p-3">
            {/* Weekday header */}
            <div className="grid grid-cols-7">
              {WEEKDAYS.map((weekday) => (
                <p
                  key={weekday}
                  className="px-2 py-2 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]"
                >
                  {weekday}
                </p>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              {cells.map((cell, index) => {
                if (!cell) {
                  return <div key={`blank-${index}`} className="min-h-[112px] border-b border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] [&:nth-child(7n)]:border-r-0" />;
                }
                const dayJobs = jobsByDay.get(cell.day) ?? [];
                const dayLaundry = laundryByDay.get(cell.day) ?? [];
                const isToday = cell.day === todayIso;
                const overflow = Math.max(0, dayJobs.length - 3);
                return (
                  <div
                    key={cell.day}
                    className={`min-h-[112px] space-y-1 border-b border-r border-[hsl(var(--e-border))] p-1.5 [&:nth-child(7n)]:border-r-0 ${
                      isToday ? "bg-[hsl(var(--e-gold-soft))]" : "bg-[hsl(var(--e-surface))]"
                    }`}
                  >
                    <p
                      className={`e-numeral px-1 text-[0.8125rem] ${
                        isToday ? "font-semibold text-[hsl(var(--e-gold-ink))]" : "text-[hsl(var(--e-muted-foreground))]"
                      }`}
                    >
                      {cell.date}
                    </p>
                    {dayJobs.slice(0, 3).map((job) => {
                      const meta = STATUS_META[job.status] ?? FALLBACK_META;
                      const unassigned = job.assignedIds.length === 0;
                      return (
                        <div
                          key={job.id}
                          className="flex items-center gap-0.5 rounded-[var(--e-radius-sm)] border transition-colors hover:bg-[hsl(var(--e-muted))]"
                          style={{ borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)` }}
                        >
                          <Link
                            href={`/v2/admin/jobs/${job.id}`}
                            className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-[0.6875rem] leading-tight"
                            title={`${job.propertyName} · ${job.jobTypeLabel} · ${meta.label}${job.cleanerName ? ` · ${job.cleanerName}` : " · Unassigned"}`}
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
                            {job.startTime ? <span className="e-tnum shrink-0 text-[hsl(var(--e-text-faint))]">{job.startTime}</span> : null}
                            <span className="min-w-0 truncate font-[550]">{job.propertyName}</span>
                            {job.cleanerName ? (
                              <span className="min-w-0 shrink truncate text-[hsl(var(--e-text-faint))]">· {job.cleanerName}</span>
                            ) : null}
                          </Link>
                          <button
                            type="button"
                            onClick={() => setAssignJob(job)}
                            aria-label={unassigned ? "Assign cleaner" : "Reassign cleaner"}
                            title={unassigned ? "Assign cleaner" : "Reassign cleaner"}
                            className={`mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--e-radius-xs)] transition-colors ${
                              unassigned
                                ? "text-[hsl(var(--e-warning))] hover:bg-[hsl(var(--e-warning-soft))]"
                                : "text-[hsl(var(--e-text-faint))] hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
                            }`}
                          >
                            <UserPlus className="h-3 w-3" aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                    {overflow > 0 ? (
                      <button
                        type="button"
                        onClick={() => setView("agenda")}
                        className="px-1 text-[0.6875rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                      >
                        +{overflow} more
                      </button>
                    ) : null}
                    {dayLaundry.slice(0, 2).map((entry) => (
                      <Link
                        key={entry.id}
                        href="/v2/admin/laundry"
                        className={`${chipCls} border-dashed`}
                        style={{ borderColor: "hsl(var(--e-info) / 0.5)", backgroundColor: "hsl(var(--e-info-soft) / 0.6)" }}
                        title={`Laundry ${entry.kind} · ${entry.propertyName}`}
                      >
                        <Shirt className="h-2.5 w-2.5 shrink-0 text-[hsl(var(--e-info))]" aria-hidden />
                        <span className="min-w-0 truncate text-[hsl(var(--e-text-secondary))]">
                          {entry.kind === "pickup" ? "Pickup" : "Drop-off"} · {entry.propertyName}
                        </span>
                      </Link>
                    ))}
                    {dayLaundry.length > 2 ? (
                      <p className="px-1 text-[0.625rem] text-[hsl(var(--e-text-faint))]">+{dayLaundry.length - 2} laundry</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Agenda: next 14 days */
          <div>
            {agendaDays.length === 0 ? (
              <EEmptyState
                eyebrow="Schedule"
                title="Nothing in the next fortnight"
                description={loading ? "Loading jobs…" : "No jobs match the current filter over the next 14 days."}
                className="border-0"
              />
            ) : (
              agendaDays.map(({ day, label, jobs: dayJobs }) => (
                <div key={day} className="border-b border-[hsl(var(--e-border))] last:border-0">
                  <div className="flex items-center justify-between bg-[hsl(var(--e-surface-raised))] px-5 py-2">
                    <p className="text-[0.8125rem] font-[550]">
                      {label}
                      {day === todayIso ? <span className="ml-2 text-[hsl(var(--e-gold-ink))]">· Today</span> : null}
                    </p>
                    <p className="e-numeral text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {dayJobs.length} {dayJobs.length === 1 ? "job" : "jobs"}
                    </p>
                  </div>
                  {dayJobs.map((job) => {
                    const meta = STATUS_META[job.status] ?? FALLBACK_META;
                    const unassigned = job.assignedIds.length === 0;
                    return (
                      <div
                        key={job.id}
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[hsl(var(--e-muted))]"
                      >
                        <Link href={`/v2/admin/jobs/${job.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
                          <span className="e-tnum w-14 shrink-0 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                            {job.startTime || "—"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.8125rem] font-[550]">{job.propertyName}</span>
                            <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                              {job.jobTypeLabel}
                              {job.suburb ? ` · ${job.suburb}` : ""}
                            </span>
                          </span>
                        </Link>
                        <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                          <User2 className="h-3 w-3 text-[hsl(var(--e-text-faint))]" aria-hidden />
                          {job.cleanerName ?? <span className="text-[hsl(var(--e-warning))]">Unassigned</span>}
                        </span>
                        <span
                          className="hidden shrink-0 rounded-[var(--e-radius-pill)] px-2 py-0.5 text-[0.6875rem] font-[550] sm:inline"
                          style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                        <EButton
                          variant={unassigned ? "gold" : "outline"}
                          size="sm"
                          onClick={() => setAssignJob(job)}
                        >
                          <UserPlus className="mr-1 h-3 w-3" aria-hidden />
                          {unassigned ? "Assign" : "Reassign"}
                        </EButton>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </ECard>

      <AssignCleanersModal
        open={Boolean(assignJob)}
        onClose={() => setAssignJob(null)}
        jobId={assignJob?.id ?? null}
        jobLabel={assignJob?.propertyName ?? "Job"}
        jobSubLabel={
          assignJob
            ? `${assignJob.jobTypeLabel}${assignJob.suburb ? ` · ${assignJob.suburb}` : ""} · ${assignJob.day}${assignJob.startTime ? ` · ${assignJob.startTime}` : ""}`
            : undefined
        }
        cleaners={cleaners}
        initialAssignedIds={assignJob?.assignedIds ?? []}
        initialPrimaryId={assignJob?.primaryId ?? null}
        onAssigned={loadJobs}
      />
    </div>
  );
}
