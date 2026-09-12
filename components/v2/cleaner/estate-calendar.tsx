"use client";

/**
 * Native Estate cleaner calendar — month grid + agenda list of the cleaner's
 * assigned jobs. Pure presentation over server-provided events; each entry deep
 * links into the Estate job workspace. No v1 calendar / UI imports.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays, ListOrdered } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { EChip } from "@/components/v2/cleaner/fields";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { cn } from "@/lib/utils";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { type JobTimingBadges } from "@/lib/jobs/timing-badges";
import { CleanerTimingSummary } from "@/components/v2/cleaner/timing-summary";
import { summarizeTiming } from "@/lib/jobs/timing-summary";
import { sydneyTodayKey } from "@/lib/time/sydney-range";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

export interface CalendarJob {
  id: string;
  dateKey: string; // YYYY-MM-DD
  title: string;
  subtitle: string;
  startTime: string | null;
  dueTime?: string | null;
  status: string;
  rawStatus?: string;
  pendingOffer?: boolean;
  timingBadges?: JobTimingBadges | null;
  sameDayCheckin?: boolean;
  sameDayCheckinTime?: string | null;
  tone: Tone;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EstateCalendar({ jobs, monthKey, todayKey = sydneyTodayKey() }: { jobs: CalendarJob[]; monthKey?: string; todayKey?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const activeMonth = monthKey ?? todayKey.slice(0, 7);
  // A cleaner who opens a job from the agenda and comes back should land on
  // the agenda, on the day they were looking at.
  const [savedView, setView] = useRestorableState<"month" | "agenda">("view", "month");
  const view = savedView === "agenda" ? "agenda" : "month";
  const [savedSelected, setSelected] = useRestorableState<string>("selected", todayKey);
  const [year, monthNumber] = activeMonth.split("-").map(Number);
  const month = monthNumber - 1;
  const selected = typeof savedSelected === "string" && savedSelected.startsWith(activeMonth + "-") &&
    /^\d{4}-\d{2}-\d{2}$/.test(savedSelected) && Number(savedSelected.slice(-2)) >= 1 &&
    Number(savedSelected.slice(-2)) <= new Date(year, month + 1, 0).getDate()
    ? savedSelected : todayKey.startsWith(activeMonth) ? todayKey : `${activeMonth}-01`;
  function navigateMonth(next: Date) {
    const nextMonth = isoKey(next).slice(0, 7);
    if (nextMonth === activeMonth) return;
    startTransition(() => router.push(`/v2/cleaner/calendar?month=${nextMonth}`, { scroll: false }));
  }

  const byDate = React.useMemo(() => {
    const map = new Map<string, CalendarJob[]>();
    for (const j of jobs.filter(job => job.dateKey.startsWith(activeMonth + "-"))) {
      const arr = map.get(j.dateKey) ?? [];
      arr.push(j);
      map.set(j.dateKey, arr);
    }
    for (const arr of Array.from(map.values())) arr.sort((a: CalendarJob, b: CalendarJob) => (a.startTime || "").localeCompare(b.startTime || ""));
    return map;
  }, [jobs, activeMonth]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const selectedJobs = byDate.get(selected) ?? [];

  const agendaKeys = Array.from(byDate.keys()).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <EChip active={view === "month"} onClick={() => setView("month")}>
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Month</span>
          </EChip>
          <EChip active={view === "agenda"} onClick={() => setView("agenda")}>
            <span className="inline-flex items-center gap-1.5"><ListOrdered className="h-3.5 w-3.5" /> Agenda</span>
          </EChip>
        </div>
          <div className="flex items-center gap-2">
            <EButton variant="ghost" size="icon" aria-label="Previous month" disabled={pending || year <= 2000 && month === 0} onClick={() => navigateMonth(new Date(year, month - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </EButton>
            <span className="min-w-[9rem] text-center text-[0.9375rem] font-[550]">
              {MONTHS[month]} {year}
            </span>
            <EButton variant="ghost" size="icon" aria-label="Next month" disabled={pending || year >= 2100 && month === 11} onClick={() => navigateMonth(new Date(year, month + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </EButton>
            <EButton variant="ghost" size="sm" disabled={pending} onClick={() => { setSelected(todayKey); navigateMonth(new Date(`${todayKey.slice(0, 7)}-01T00:00:00`)); }}>Today</EButton>
          </div>
      </div>

      {pending ? <p role="status">Loading schedule...</p> : view === "month" ? (
        <>
          <ECard>
            <ECardBody className="pt-6">
              <div className="grid grid-cols-7 gap-1">
                {DOW.map((d) => (
                  <div key={d} className="pb-2 text-center text-[0.6875rem] font-[550] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
                    {d}
                  </div>
                ))}
                {cells.map((date, i) => {
                  if (!date) return <div key={`e${i}`} />;
                  const key = isoKey(date);
                  const dayJobs = byDate.get(key) ?? [];
                  const isToday = key === todayKey;
                  const isSel = key === selected;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`${key}, ${dayJobs.length} ${dayJobs.length === 1 ? "job" : "jobs"}`}
                      aria-pressed={isSel}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => setSelected(key)}
                      className={cn(
                        "flex min-h-[3.25rem] flex-col items-center gap-1 rounded-[var(--e-radius)] border p-1 text-center transition-colors",
                        isSel
                          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]"
                          : "border-transparent hover:bg-[hsl(var(--e-muted))]"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-[0.8125rem] tabular-nums",
                          isToday ? "bg-[hsl(var(--e-gold))] font-semibold text-[hsl(var(--e-gold-foreground))]" : ""
                        )}
                      >
                        {date.getDate()}
                      </span>
                      {dayJobs.length > 0 ? (
                        <span className="flex gap-0.5">
                          {dayJobs.slice(0, 3).map((j) => (
                            <span key={j.id} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor(j.tone) }} />
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </ECardBody>
          </ECard>

          <div className="space-y-2">
            <p className="e-eyebrow">{formatSelected(selected)}</p>
            {selectedJobs.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No jobs on this day.</p>
            ) : (
              selectedJobs.map((j) => <JobRow key={j.id} job={j} />)
            )}
          </div>
        </>
      ) : agendaKeys.length === 0 ? (
        <EEmptyState eyebrow="Schedule" title="No jobs this month" description="No assigned jobs were found for the selected month." />
      ) : (
        <div className="space-y-5">
          {agendaKeys.map((key) => (
            <div key={key} className="space-y-2">
              <p className="e-eyebrow">{formatSelected(key)}</p>
              {(byDate.get(key) ?? []).map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: CalendarJob }) {
  const timing = summarizeTiming(job);
  const isOffered = job.pendingOffer ?? job.rawStatus === "OFFERED";
  const body = (
    <ECardBody className="flex flex-wrap items-center gap-3 pt-6">
      <div className="flex min-h-11 w-16 shrink-0 flex-col items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]">
        <span className="text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">Planned start</span>
        <span className="text-[0.8125rem] font-semibold tabular-nums">{timing.plannedStart || "Not set"}</span>
      </div>
      <div className="min-w-0 flex-1">
        {/* Wraps rather than truncates: the schedule is scanned by property
            name, and half a name identifies nothing. */}
        <p className="text-[0.875rem] font-[550] leading-snug [overflow-wrap:anywhere]">{job.title}</p>
        <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{job.subtitle}</p>
      </div>
      <EBadge tone={job.tone} soft>
        {job.status}
      </EBadge>
      {timing.plannedFinish ? <p className="w-full text-xs text-[hsl(var(--e-muted-foreground))]">Planned finish: {timing.plannedFinish}</p> : null}
      <CleanerTimingSummary {...job} showPlanned={false} />
      {isOffered ? (
        <div className="flex w-full items-center justify-between gap-2">
          <Link
            href={`/v2/cleaner/jobs/${job.id}`}
            className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:underline"
          >
            View job
          </Link>
          <JobOfferActions jobId={job.id} size="sm" />
        </div>
      ) : null}
    </ECardBody>
  );
  // OFFERED rows carry inline Accept/Decline buttons, so they must not be wrapped
  // in an anchor (no interactive controls inside a link).
  return isOffered ? (
    <ECard>{body}</ECard>
  ) : (
    <Link href={`/v2/cleaner/jobs/${job.id}`} className="block">
      <ECard>{body}</ECard>
    </Link>
  );
}

function formatSelected(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DOW[date.getDay()]} · ${d} ${MONTHS[m - 1]}`.toUpperCase();
}

function dotColor(tone: Tone) {
  const map: Record<Tone, string> = {
    neutral: "hsl(var(--e-muted-foreground))",
    primary: "hsl(var(--e-accent-portal))",
    gold: "hsl(var(--e-gold))",
    success: "hsl(var(--e-success))",
    warning: "hsl(var(--e-warning))",
    danger: "hsl(var(--e-danger))",
    info: "hsl(var(--e-info))",
    aubergine: "hsl(284 22% 44%)",
  };
  return map[tone];
}
