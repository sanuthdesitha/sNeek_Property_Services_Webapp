"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  MapPin,
  RefreshCw,
  Sparkles,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const SYDNEY_TZ = "Australia/Sydney";

const STATUS_META: Record<
  string,
  { color: string; soft: string; badge: any; label: string }
> = {
  UNASSIGNED: { color: "#f59e0b", soft: "rgba(245,158,11,0.14)", badge: "warning", label: "Unassigned" },
  OFFERED: { color: "#d97706", soft: "rgba(217,119,6,0.14)", badge: "warning", label: "Awaiting Confirmation" },
  ASSIGNED: { color: "#2563eb", soft: "rgba(37,99,235,0.14)", badge: "secondary", label: "Assigned" },
  IN_PROGRESS: { color: "#0f766e", soft: "rgba(15,118,110,0.14)", badge: "default", label: "In Progress" },
  PAUSED: { color: "#d97706", soft: "rgba(217,119,6,0.16)", badge: "warning", label: "Paused" },
  WAITING_CONTINUATION_APPROVAL: { color: "#dc2626", soft: "rgba(220,38,38,0.14)", badge: "destructive", label: "Waiting Approval" },
  SUBMITTED: { color: "#4f46e5", soft: "rgba(79,70,229,0.14)", badge: "secondary", label: "Submitted" },
  QA_REVIEW: { color: "#ea580c", soft: "rgba(234,88,12,0.14)", badge: "warning", label: "QA Review" },
  COMPLETED: { color: "#16a34a", soft: "rgba(22,163,74,0.14)", badge: "success", label: "Completed" },
  INVOICED: { color: "#64748b", soft: "rgba(100,116,139,0.14)", badge: "outline", label: "Invoiced" },
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  classNames: string[];
  extendedProps: {
    status: string;
    suburb: string;
    propertyName: string;
    jobTypeLabel: string;
    startTime?: string;
    dueTime?: string;
    assignedCount: number;
  };
};

function getEventTextPalette(backgroundColor?: string | null) {
  const value = (backgroundColor ?? "").replace(/\s+/g, "").toLowerCase();
  const isLightRgba = value.startsWith("rgba(") || value.startsWith("hsla(");

  if (isLightRgba || !value) {
    return {
      primary: "text-slate-900",
      secondary: "text-slate-600",
      tertiary: "text-slate-500",
      dotClass: "bg-current",
      dotStyle: undefined as CSSProperties | undefined,
      pillClass: "bg-white/90 text-slate-700",
    };
  }

  return {
    primary: "text-white",
    secondary: "text-white/80",
    tertiary: "text-white/70",
    dotClass: "bg-white/85",
    dotStyle: undefined as CSSProperties | undefined,
    pillClass: "bg-white/20 text-white",
  };
}

function getSydneyDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value?: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export default function CalendarView() {
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [boardExpanded, setBoardExpanded] = useState(false);
  const [undoState, setUndoState] = useState<null | {
    jobId: string;
    payload: { scheduledDate: string; startTime: string | null; endTime: string | null };
  }>(null);

  function loadJobs() {
    setLoading(true);
    fetch("/api/jobs", { cache: "no-store" })
      .then((r) => r.json())
      .then((jobs: any[]) => {
        if (!Array.isArray(jobs)) {
          setEvents([]);
          return;
        }
        setEvents(
          jobs.map((job) => {
            const status = job.status as string;
            const meta = STATUS_META[status] ?? STATUS_META.ASSIGNED;
            const jobTypeLabel = String(job.jobType ?? "").replace(/_/g, " ");
            return {
              id: job.id,
              title: `${job.property.name} - ${jobTypeLabel}`,
              start: job.startTime
                ? `${job.scheduledDate.split("T")[0]}T${job.startTime}:00`
                : job.scheduledDate,
              end: job.endTime
                ? `${job.scheduledDate.split("T")[0]}T${job.endTime}:00`
                : undefined,
              backgroundColor: meta.soft,
              borderColor: meta.color,
              textColor: "#0f172a",
              classNames: ["sneek-calendar-event", `status-${status.toLowerCase()}`],
              extendedProps: {
                status,
                suburb: job.property?.suburb ?? "",
                propertyName: job.property?.name ?? "Property",
                jobTypeLabel,
                startTime: job.startTime ?? undefined,
                dueTime: job.dueTime ?? undefined,
                assignedCount: Array.isArray(job.assignments) ? job.assignments.length : 0,
              },
            };
          })
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const syncViewport = () => setIsCompactViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!undoState) return;
    const timeout = window.setTimeout(() => setUndoState(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [undoState]);

  const counts = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, event) => {
      const status = event.extendedProps.status;
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
  }, [events]);

  const todayIso = useMemo(() => getSydneyDateIso(), []);

  const summary = useMemo(
    () => [
      {
        label: "Jobs in range",
        value: events.length,
        icon: CalendarClock,
        note: "Everything visible in the current dispatch calendar.",
        accent: "from-sky-500/10 via-cyan-500/10 to-transparent",
      },
      {
        label: "Need assignment",
        value: counts.UNASSIGNED ?? 0,
        icon: MapPin,
        note: "Still unassigned and ready for dispatch action.",
        accent: "from-amber-500/10 via-orange-500/10 to-transparent",
      },
      {
        label: "In progress",
        value: counts.IN_PROGRESS ?? 0,
        icon: Clock3,
        note: "Live jobs currently active in the field.",
        accent: "from-teal-500/10 via-emerald-500/10 to-transparent",
      },
      {
        label: "Completed",
        value: counts.COMPLETED ?? 0,
        icon: CheckCircle2,
        note: "Finished work already completed in the loaded range.",
        accent: "from-emerald-500/10 via-lime-500/10 to-transparent",
      },
    ],
    [counts, events.length]
  );

  const todaySpotlight = useMemo(() => {
    const todayJobs = events.filter((event) => event.start.slice(0, 10) === todayIso);
    const awaitingToday = todayJobs.filter((event) =>
      ["UNASSIGNED", "OFFERED"].includes(event.extendedProps.status)
    );
    const inProgressToday = todayJobs.filter((event) => event.extendedProps.status === "IN_PROGRESS");
    const exceptionsToday = todayJobs.filter((event) =>
      ["WAITING_CONTINUATION_APPROVAL", "PAUSED", "QA_REVIEW"].includes(event.extendedProps.status)
    );
    const nextJob = [...events]
      .filter((event) => event.start >= `${todayIso}T00:00:00` || event.start === todayIso)
      .sort((a, b) => a.start.localeCompare(b.start))[0];

    return {
      todayJobs,
      awaitingToday,
      inProgressToday,
      exceptionsToday,
      nextJob,
    };
  }, [events, todayIso]);

  function renderEventContent(arg: EventContentArg) {
    const details = arg.event.extendedProps as CalendarEvent["extendedProps"];
    const statusMeta = STATUS_META[details.status] ?? STATUS_META.ASSIGNED;
    const palette = getEventTextPalette(arg.event.backgroundColor);
    const isMonthView = arg.view.type === "dayGridMonth";
    const isDayView = arg.view.type === "timeGridDay";
    const isTimeGridView = arg.view.type.startsWith("timeGrid");

    if (isMonthView) {
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${palette.dotClass}`}
              style={palette.dotClass === "bg-current" ? { backgroundColor: statusMeta.color } : palette.dotStyle}
            />
            <span className={`truncate text-[10px] font-semibold uppercase tracking-[0.08em] ${palette.secondary}`}>
              {statusMeta.label}
            </span>
            {details.assignedCount > 1 ? (
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${palette.pillClass}`}>
                +{details.assignedCount}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            {arg.timeText ? (
              <span className={`shrink-0 text-[10px] font-semibold ${palette.secondary}`}>{arg.timeText}</span>
            ) : null}
            <span className={`truncate text-[11px] font-semibold ${palette.primary}`}>{details.propertyName}</span>
          </div>
          <span className={`truncate text-[10px] ${palette.tertiary}`}>
            {details.jobTypeLabel}
            {details.suburb ? ` | ${details.suburb}` : ""}
          </span>
        </div>
      );
    }

    if (isTimeGridView) {
      return (
        <div className="flex h-full min-w-0 flex-col gap-1 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[10px] font-semibold uppercase tracking-[0.08em] ${palette.secondary}`}>
              {statusMeta.label}
            </span>
            {arg.timeText ? <span className={`shrink-0 text-[10px] font-semibold ${palette.secondary}`}>{arg.timeText}</span> : null}
          </div>
          <div className={`line-clamp-2 text-[11px] font-semibold leading-4 sm:text-[12px] ${palette.primary}`}>
            {details.propertyName}
          </div>
          {isDayView ? (
            <>
              <div className={`truncate text-[10px] leading-4 ${palette.secondary}`}>
                {details.jobTypeLabel}
                {details.suburb ? ` | ${details.suburb}` : ""}
              </div>
              {details.startTime || details.dueTime ? (
                <div className={`truncate text-[10px] leading-4 ${palette.tertiary}`}>
                  {details.startTime || "No start"}
                  {details.dueTime ? ` - ${details.dueTime}` : ""}
                  {details.assignedCount > 0 ? ` | ${details.assignedCount} assigned` : ""}
                </div>
              ) : null}
            </>
          ) : (
            <div className={`truncate text-[10px] leading-4 ${palette.secondary}`}>
              {details.jobTypeLabel}
              {details.assignedCount > 0 ? ` | ${details.assignedCount} assigned` : ""}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className={`truncate text-[11px] font-semibold uppercase tracking-[0.12em] ${palette.secondary}`}>
            {statusMeta.label}
          </span>
          {arg.timeText ? <span className={`shrink-0 text-[11px] ${palette.secondary}`}>{arg.timeText}</span> : null}
        </div>
        <div className={`truncate text-xs font-semibold sm:text-[13px] ${palette.primary}`}>{details.propertyName}</div>
        <div className={`truncate text-[11px] ${palette.secondary}`}>
          {details.jobTypeLabel}
          {details.suburb ? ` • ${details.suburb}` : ""}
        </div>
        {details.startTime || details.dueTime ? (
          <div className={`truncate text-[11px] ${palette.tertiary}`}>
            {details.startTime || "No start"}
            {details.dueTime ? ` - ${details.dueTime}` : ""}
          </div>
        ) : null}
      </div>
    );
  }

  async function persistCalendarMove(input: {
    jobId: string;
    scheduledDate: string;
    startTime: string | null;
    endTime: string | null;
  }) {
    const res = await fetch(`/api/admin/jobs/${input.jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error ?? "Could not update the job schedule.");
    }
  }

  async function handleEventMove(arg: EventDropArg | EventResizeDoneArg) {
    const start = arg.event.start;
    if (!start) {
      arg.revert();
      return;
    }
    const previousStart = arg.oldEvent.start ?? start;
    const previousEnd = arg.oldEvent.end ?? null;
    const nextEnd = arg.event.end ?? null;
    const payload = {
      jobId: arg.event.id,
      scheduledDate: start.toISOString().slice(0, 10),
      startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      endTime: nextEnd
        ? `${String(nextEnd.getHours()).padStart(2, "0")}:${String(nextEnd.getMinutes()).padStart(2, "0")}`
        : null,
    };
    const undoPayload = {
      scheduledDate: previousStart.toISOString().slice(0, 10),
      startTime: `${String(previousStart.getHours()).padStart(2, "0")}:${String(previousStart.getMinutes()).padStart(2, "0")}`,
      endTime: previousEnd
        ? `${String(previousEnd.getHours()).padStart(2, "0")}:${String(previousEnd.getMinutes()).padStart(2, "0")}`
        : null,
    };
    try {
      await persistCalendarMove(payload);
      setUndoState({ jobId: arg.event.id, payload: undoPayload });
      toast({ title: "Job schedule updated", description: "Drag-and-drop changes were saved." });
    } catch (error: any) {
      arg.revert();
      toast({
        title: "Schedule update failed",
        description: error?.message ?? "Could not save the new job time.",
        variant: "destructive",
      });
    }
  }

  async function undoCalendarMove() {
    if (!undoState) return;
    try {
      await persistCalendarMove({
        jobId: undoState.jobId,
        scheduledDate: undoState.payload.scheduledDate,
        startTime: undoState.payload.startTime,
        endTime: undoState.payload.endTime,
      });
      setUndoState(null);
      loadJobs();
      toast({ title: "Schedule change reverted" });
    } catch (error: any) {
      toast({
        title: "Undo failed",
        description: error?.message ?? "Could not restore the previous schedule.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="jobs-admin-calendar space-y-5 p-4 sm:p-5">
      <Card className="overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(37,99,235,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))]">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="border-primary/15 bg-primary/10 text-primary">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Dispatch command view
                </Badge>
                <Badge variant="outline" className="border-border/70 bg-white/75">
                  {boardExpanded ? "Expanded" : "Collapsed"}
                </Badge>
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Schedule Board
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                Dispatch briefing and schedule context
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Keep this collapsed for a faster workspace, then expand it when you need the richer operational summary.
              </p>
            </div>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setBoardExpanded((value) => !value)}>
              {boardExpanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
              {boardExpanded ? "Hide schedule board" : "Show schedule board"}
            </Button>
          </div>
          {boardExpanded ? (
          <div className="grid gap-0 border-t border-border/60 xl:grid-cols-[1.08fr_0.92fr]">
            <div className="p-5 sm:p-6">
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Schedule Board
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Jobs mapped by day, week, and shift with live status context
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Use the month view to spot workload clusters, switch to week or day for tighter dispatch planning, and
                update schedules directly from the calendar when operations needs to move fast.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button type="button" className="rounded-full px-5" onClick={loadJobs}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh board
                </Button>
                <div className="inline-flex items-center rounded-full border border-border/70 bg-white/80 px-4 py-2 text-sm text-muted-foreground">
                  <CalendarRange className="mr-2 h-4 w-4 text-primary" />
                  Drag and resize jobs to adjust the schedule
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summary.map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-2xl border border-white/70 bg-gradient-to-br ${item.accent} p-3 shadow-sm backdrop-blur`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 shadow-sm">
                        <item.icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.note}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/60 bg-slate-950/[0.03] p-5 sm:p-6 xl:border-l xl:border-t-0">
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Today spotlight
                    </p>
                    <h4 className="mt-2 text-xl font-semibold">What matters first today</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Snapshot for {formatDateLabel(todayIso)} in Sydney time.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-primary/10 p-3">
                    <CalendarClock className="h-5 w-5 text-primary" />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border/60 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Jobs today</p>
                    <p className="mt-1 text-xl font-semibold">{todaySpotlight.todayJobs.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Awaiting action</p>
                    <p className="mt-1 text-xl font-semibold">{todaySpotlight.awaitingToday.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Exceptions</p>
                    <p className="mt-1 text-xl font-semibold">{todaySpotlight.exceptionsToday.length}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-xl bg-sky-100 p-2 text-sky-700">
                        <CalendarClock className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Next scheduled job</p>
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {todaySpotlight.nextJob?.extendedProps.propertyName ?? "No upcoming job in this range"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {todaySpotlight.nextJob
                            ? `${todaySpotlight.nextJob.extendedProps.jobTypeLabel}${todaySpotlight.nextJob.extendedProps.suburb ? ` | ${todaySpotlight.nextJob.extendedProps.suburb}` : ""}`
                            : "Refresh or change the calendar range"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-xl bg-emerald-100 p-2 text-emerald-700">
                        <Clock3 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Currently active</p>
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {todaySpotlight.inProgressToday.length
                            ? `${todaySpotlight.inProgressToday.length} job${todaySpotlight.inProgressToday.length === 1 ? "" : "s"} in progress`
                            : "No active jobs right now"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Live jobs stay highlighted in the calendar and dashboard.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Status legend
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(STATUS_META).map(([status, meta]) => (
                      <Badge key={status} variant={meta.badge}>
                        {meta.label} ({counts[status] ?? 0})
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.3fr]">
        <div className="relative overflow-visible rounded-[calc(var(--radius)+10px)] border border-white/70 bg-white/80 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="border-b border-border/60 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.78))] px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Calendar canvas</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Month, week, and day views use the same polished dispatch theme and support drag-and-drop rescheduling.
                </p>
              </div>
              <Badge variant="outline" className="border-border/70 bg-white/80">
                {events.length} jobs loaded
              </Badge>
            </div>
          </div>
          <div className="relative overflow-visible rounded-b-[calc(var(--radius)+10px)]">
        {undoState ? (
          <div className="border-b border-border/60 bg-amber-50/80 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-amber-900">Schedule moved. You can undo this change for the next 5 seconds.</p>
              <Button type="button" size="sm" variant="outline" onClick={undoCalendarMove}>
                <Undo2 className="mr-2 h-4 w-4" />
                Undo
              </Button>
            </div>
          </div>
        ) : null}
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          buttonText={{
            today: "Today",
            month: "Month",
            week: "Week",
            day: "Day",
          }}
          events={events}
          eventContent={renderEventContent}
          eventClick={({ event }) => router.push(`/admin/jobs/${event.id}`)}
          editable
          eventDrop={handleEventMove}
          eventResize={handleEventMove}
          height="auto"
          stickyHeaderDates
          dayMaxEventRows={4}
          moreLinkClick="popover"
          fixedWeekCount={false}
          eventOrder="start,-duration,title"
          nowIndicator
          weekNumbers
          timeZone="Australia/Sydney"
          eventTimeFormat={
            isCompactViewport
              ? { hour: "numeric", meridiem: "short" }
              : {
                  hour: "numeric",
                  minute: "2-digit",
                  meridiem: "short",
                }
          }
          slotLabelFormat={
            isCompactViewport
              ? { hour: "numeric", meridiem: "short" }
              : {
                  hour: "numeric",
                  minute: "2-digit",
                  meridiem: "short",
                }
          }
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          scrollTime="07:00:00"
          slotEventOverlap={false}
          eventMinHeight={76}
          expandRows
          views={{
            timeGridWeek: {
              dayHeaderFormat: { weekday: "short", day: "numeric", month: "short" },
            },
            timeGridDay: {
              dayHeaderFormat: { weekday: "long", day: "numeric", month: "long" },
            },
          }}
          eventDidMount={(info) => {
            const details = info.event.extendedProps as CalendarEvent["extendedProps"];
            info.el.setAttribute(
              "title",
              `${details.propertyName} | ${details.jobTypeLabel}${details.suburb ? ` | ${details.suburb}` : ""}`
            );
          }}
        />
          </div>
        </div>

        <Card className="border-primary/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9))]">
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quick context</p>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-2 text-primary">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Open full job detail from any event</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Click a calendar card to jump straight into the job record, timeline, and operational notes.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
                    <Undo2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Schedule changes are reversible</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Drag or resize a job to reschedule it, then use the temporary undo action if the move needs to be reversed.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-rose-100 p-2 text-rose-700">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Exceptions stay visible</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Paused jobs, QA review, and waiting-approval items stay visually distinct so dispatch can act fast.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <style jsx global>{`
        .jobs-admin-calendar .fc {
          position: relative;
          z-index: 0;
          --fc-border-color: rgba(148, 163, 184, 0.22);
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: rgba(248, 250, 252, 0.72);
          --fc-today-bg-color: rgba(37, 99, 235, 0.06);
          --fc-button-bg-color: #0f766e;
          --fc-button-border-color: #0f766e;
          --fc-button-text-color: #f8fafc;
          --fc-button-hover-bg-color: #115e59;
          --fc-button-hover-border-color: #115e59;
          --fc-button-active-bg-color: #134e4a;
          --fc-button-active-border-color: #134e4a;
          --fc-button-active-text-color: #ffffff;
        }

        .jobs-admin-calendar .fc .fc-toolbar.fc-header-toolbar {
          margin-bottom: 1rem;
          padding: 1rem 1rem 0.25rem;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .jobs-admin-calendar .fc .fc-toolbar-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: #0f172a;
        }

        .jobs-admin-calendar .fc .fc-button {
          border-radius: 9999px;
          box-shadow: 0 10px 24px -18px rgba(15, 23, 42, 0.55);
          font-weight: 600;
          padding: 0.45rem 0.85rem;
          color: #f8fafc;
        }

        .jobs-admin-calendar .fc .fc-scrollgrid,
        .jobs-admin-calendar .fc .fc-timegrid-slot,
        .jobs-admin-calendar .fc .fc-timegrid-axis,
        .jobs-admin-calendar .fc .fc-col-header-cell,
        .jobs-admin-calendar .fc .fc-daygrid-day {
          border-color: rgba(148, 163, 184, 0.22);
        }

        .jobs-admin-calendar .fc .fc-col-header-cell-cushion,
        .jobs-admin-calendar .fc .fc-daygrid-day-number {
          color: #334155;
          font-weight: 600;
          padding: 0.55rem 0.35rem;
        }

        .jobs-admin-calendar .fc .fc-day-today .fc-daygrid-day-number {
          color: #2563eb;
        }

        .jobs-admin-calendar .fc .fc-day-today {
          box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.12);
          background: linear-gradient(180deg, rgba(37, 99, 235, 0.04), rgba(255, 255, 255, 0));
        }

        .jobs-admin-calendar .fc .fc-day-other {
          background: rgba(248, 250, 252, 0.65);
        }

        .jobs-admin-calendar .fc .fc-week-number {
          display: inline-flex;
          min-width: 1.7rem;
          height: 1.7rem;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: rgba(15, 118, 110, 0.08);
          color: #0f766e;
          font-size: 0.7rem;
          font-weight: 700;
        }

        .jobs-admin-calendar .fc .sneek-calendar-event {
          border-width: 1px;
          border-radius: 16px;
          padding: 0.38rem 0.45rem;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.35),
            0 14px 30px -26px rgba(15, 23, 42, 0.65);
          transition: transform 160ms ease, box-shadow 160ms ease;
        }

        .jobs-admin-calendar .fc .sneek-calendar-event:hover {
          transform: translateY(-1px);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.4),
            0 20px 36px -26px rgba(15, 23, 42, 0.75);
        }

        .jobs-admin-calendar .fc .fc-daygrid-event-harness {
          margin-top: 0.22rem;
        }

        .jobs-admin-calendar .fc .fc-daygrid-event {
          min-height: 1.6rem;
        }

        .jobs-admin-calendar .fc .fc-daygrid-day-events {
          margin: 0 0.2rem 0.25rem;
        }

        .jobs-admin-calendar .fc .fc-daygrid-more-link {
          margin: 0.18rem 0.3rem 0.25rem;
          font-size: 0.72rem;
          font-weight: 600;
          color: #2563eb;
        }

        .jobs-admin-calendar .fc .fc-daygrid-more-link:hover {
          color: #1d4ed8;
        }

        .jobs-admin-calendar .fc .fc-event-main {
          padding: 0;
        }

        .jobs-admin-calendar .fc .fc-popover {
          z-index: 40;
          background: #ffffff;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          opacity: 1;
          overflow: hidden;
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18);
        }

        .jobs-admin-calendar .fc .fc-popover-header {
          padding: 0.7rem 0.9rem;
          background: #f8fafc;
        }

        .jobs-admin-calendar .fc .fc-popover-title,
        .jobs-admin-calendar .fc .fc-popover-close {
          color: #0f172a;
        }

        .jobs-admin-calendar .fc .fc-more-popover .fc-popover-body {
          background: #ffffff;
          padding: 0.45rem 0.55rem 0.65rem;
        }

        .jobs-admin-calendar .fc .fc-more-popover .fc-daygrid-event-harness,
        .jobs-admin-calendar .fc .fc-more-popover .fc-daygrid-event-harness-abs {
          position: relative !important;
          inset: auto !important;
          display: block !important;
          margin-top: 0.28rem !important;
        }

        .jobs-admin-calendar .fc .fc-more-popover .fc-daygrid-event {
          margin: 0 !important;
        }

        .jobs-admin-calendar .fc .fc-view-harness,
        .jobs-admin-calendar .fc .fc-view-harness-active {
          overflow: visible;
        }

        .jobs-admin-calendar .fc .fc-scrollgrid {
          border-radius: calc(var(--radius) + 6px);
          overflow: hidden;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9));
        }

        .jobs-admin-calendar .fc .fc-timegrid-slot-label-cushion,
        .jobs-admin-calendar .fc .fc-timegrid-axis-cushion {
          font-size: 0.8rem;
          font-weight: 600;
          color: #64748b;
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding: 0 0.25rem;
          max-width: 100%;
          box-sizing: border-box;
        }
        .jobs-admin-calendar .fc .fc-timegrid-axis {
          width: 4.3rem;
        }
        .jobs-admin-calendar .fc .fc-timegrid-axis-frame,
        .jobs-admin-calendar .fc .fc-timegrid-slot-label-frame {
          overflow: hidden;
        }
        .jobs-admin-calendar .fc .fc-timegrid-slot {
          height: 2.9rem;
        }

        .jobs-admin-calendar .fc .fc-timegrid-col-events {
          margin: 0 0.2rem;
        }

        .jobs-admin-calendar .fc .fc-timegrid-event {
          min-height: 76px;
          border-radius: 16px;
          padding: 0.24rem;
          box-shadow: 0 10px 24px -20px rgba(15, 23, 42, 0.5);
        }

        .jobs-admin-calendar .fc .fc-timegrid-event .fc-event-main {
          display: flex;
          height: 100%;
          align-items: stretch;
          padding: 0.12rem;
          overflow: hidden;
        }

        .jobs-admin-calendar .fc .fc-timegrid-event .fc-event-main > div {
          width: 100%;
          overflow: hidden;
        }

        .jobs-admin-calendar .fc .fc-timegrid-event .fc-event-title,
        .jobs-admin-calendar .fc .fc-timegrid-event .fc-event-time {
          white-space: normal;
        }

        .jobs-admin-calendar .fc .fc-timegrid-event-harness {
          margin-inline: 0.1rem;
        }

        .jobs-admin-calendar .fc .fc-timegrid-now-indicator-line {
          border-color: #ef4444;
        }

        .jobs-admin-calendar .fc .fc-timegrid-now-indicator-arrow {
          border-top-color: #ef4444;
          border-bottom-color: #ef4444;
        }

        @media (max-width: 768px) {
          .jobs-admin-calendar .fc .fc-toolbar.fc-header-toolbar {
            padding: 0.85rem 0.85rem 0;
          }

          .jobs-admin-calendar .fc .fc-toolbar-title {
            font-size: 0.95rem;
          }

          .jobs-admin-calendar .fc .fc-button {
            padding: 0.4rem 0.65rem;
            font-size: 0.75rem;
          }
          .jobs-admin-calendar .fc .fc-toolbar-chunk {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
          }
          .jobs-admin-calendar .fc .fc-timegrid-axis {
            width: 3rem;
          }
          .jobs-admin-calendar .fc .fc-timegrid-slot-label-cushion,
          .jobs-admin-calendar .fc .fc-timegrid-axis-cushion {
            font-size: 0.68rem;
            padding: 0 0.15rem;
          }

          .jobs-admin-calendar .fc .fc-daygrid-day-events {
            margin-inline: 0.1rem;
          }

          .jobs-admin-calendar .fc .fc-daygrid-more-link {
            margin-inline: 0.18rem;
          }

          .jobs-admin-calendar .fc .fc-timegrid-col-events {
            margin: 0 0.08rem;
          }

          .jobs-admin-calendar .fc .fc-timegrid-slot {
            height: 2.45rem;
          }

          .jobs-admin-calendar .fc .fc-timegrid-event {
            min-height: 64px;
          }
        }
      `}</style>
    </div>
  );
}
