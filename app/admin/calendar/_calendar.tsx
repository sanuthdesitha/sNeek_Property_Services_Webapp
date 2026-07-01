"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DatesSetArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, RefreshCw, Undo2, User2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const SYDNEY_TZ = "Australia/Sydney";

type CalendarViewPreference = "dayGridMonth" | "timeGridWeek" | "timeGridDay";

const VIEW_OPTIONS: Array<{ value: CalendarViewPreference; label: string }> = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
];

// Token-based palette: variant names map to CSS custom properties in app/globals.css.
const STATUS_META: Record<
  string,
  { variant: "warning" | "primary" | "info" | "danger" | "success" | "accent" | "muted"; label: string }
> = {
  UNASSIGNED: { variant: "warning", label: "Unassigned" },
  OFFERED: { variant: "warning", label: "Awaiting Confirmation" },
  ASSIGNED: { variant: "primary", label: "Assigned" },
  IN_PROGRESS: { variant: "info", label: "In Progress" },
  PAUSED: { variant: "warning", label: "Paused" },
  WAITING_CONTINUATION_APPROVAL: { variant: "danger", label: "Waiting Approval" },
  SUBMITTED: { variant: "accent", label: "Submitted" },
  QA_REVIEW: { variant: "accent", label: "QA Review" },
  COMPLETED: { variant: "success", label: "Completed" },
  INVOICED: { variant: "muted", label: "Invoiced" },
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
    cleanerName?: string;
    assignedCount: number;
  };
};

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

function cleanerLabel(job: any): string | undefined {
  const names: string[] = Array.isArray(job?.assignments)
    ? job.assignments
        .map((assignment: any) => assignment?.user?.name)
        .filter((name: unknown): name is string => Boolean(name))
    : [];
  if (names.length === 0) return undefined;
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

export default function CalendarView() {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [currentView, setCurrentView] = useState<CalendarViewPreference>("dayGridMonth");
  const [periodLabel, setPeriodLabel] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [agendaMode, setAgendaMode] = useState(false);
  const explicitViewRef = useRef(false);
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
              backgroundColor: `hsl(var(--${meta.variant}) / 0.18)`,
              borderColor: `hsl(var(--${meta.variant}) / 0.55)`,
              textColor: "hsl(var(--foreground))",
              classNames: ["sneek-calendar-event", `status-${status.toLowerCase()}`],
              extendedProps: {
                status,
                suburb: job.property?.suburb ?? "",
                propertyName: job.property?.name ?? "Property",
                jobTypeLabel,
                startTime: job.startTime ?? undefined,
                dueTime: job.dueTime ?? undefined,
                cleanerName: cleanerLabel(job),
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
    const compact = media.matches;
    setIsCompactViewport(compact);
    const initial: CalendarViewPreference = compact ? "timeGridDay" : "dayGridMonth";
    setCurrentView(initial);
    const api = calendarRef.current?.getApi();
    if (api && api.view.type !== initial) api.changeView(initial);

    const sync = (event: MediaQueryListEvent) => {
      setIsCompactViewport(event.matches);
      if (explicitViewRef.current) return;
      const next: CalendarViewPreference = event.matches ? "timeGridDay" : "dayGridMonth";
      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi && calendarApi.view.type !== next) calendarApi.changeView(next);
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
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

  const visibleEvents = useMemo(
    () => (statusFilter === "ALL" ? events : events.filter((event) => event.extendedProps.status === statusFilter)),
    [events, statusFilter]
  );

  // Agenda view: upcoming jobs, closest first. Includes anything from the start
  // of today onward, grouped by day.
  const agendaGroups = useMemo(() => {
    const cutoff = `${todayIso}T00:00:00`;
    const upcoming = visibleEvents
      .filter((event) => (event.end ?? event.start) >= cutoff)
      .sort((a, b) => a.start.localeCompare(b.start));
    const groups = new Map<string, CalendarEvent[]>();
    for (const event of upcoming) {
      const day = event.start.slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(event);
    }
    return Array.from(groups.entries());
  }, [visibleEvents, todayIso]);

  function renderEventContent(arg: EventContentArg) {
    const details = arg.event.extendedProps as CalendarEvent["extendedProps"];
    const statusMeta = STATUS_META[details.status] ?? STATUS_META.ASSIGNED;
    const isMonthView = arg.view.type === "dayGridMonth";
    const isTimeGridView = arg.view.type.startsWith("timeGrid");

    const cleaner = details.cleanerName ? (
      <span className="inline-flex min-w-0 items-center gap-1 text-foreground/90">
        <User2 className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{details.cleanerName}</span>
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-warning">
        <User2 className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
        <span className="truncate">Unassigned</span>
      </span>
    );

    if (isMonthView) {
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: `hsl(var(--${statusMeta.variant}))` }}
            />
            {arg.timeText ? (
              <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{arg.timeText}</span>
            ) : null}
            <span className="truncate text-[11px] font-semibold text-foreground">{details.propertyName}</span>
          </div>
          <div className="truncate text-[10px] font-medium leading-3">{cleaner}</div>
        </div>
      );
    }

    if (isTimeGridView) {
      return (
        <div className="flex h-full min-w-0 flex-col gap-1 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {statusMeta.label}
            </span>
            {arg.timeText ? <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{arg.timeText}</span> : null}
          </div>
          <div className="line-clamp-2 text-[11px] font-semibold leading-4 text-foreground sm:text-[12px]">
            {details.propertyName}
          </div>
          <div className="truncate text-[10px] font-medium leading-4">{cleaner}</div>
          <div className="truncate text-[10px] leading-4 text-muted-foreground">
            {details.jobTypeLabel}
            {details.suburb ? ` · ${details.suburb}` : ""}
          </div>
        </div>
      );
    }

    // List / fallback
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {statusMeta.label}
          </span>
          {arg.timeText ? <span className="shrink-0 text-[11px] text-muted-foreground">{arg.timeText}</span> : null}
        </div>
        <div className="truncate text-xs font-semibold text-foreground sm:text-[13px]">{details.propertyName}</div>
        <div className="truncate text-[11px] font-medium">{cleaner}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {details.jobTypeLabel}
          {details.suburb ? ` · ${details.suburb}` : ""}
        </div>
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

  function changeView(view: CalendarViewPreference) {
    explicitViewRef.current = true;
    const api = calendarRef.current?.getApi();
    if (api) api.changeView(view);
    setCurrentView(view);
  }

  function handleDatesSet(arg: DatesSetArg) {
    if (
      arg.view.type === "dayGridMonth" ||
      arg.view.type === "timeGridWeek" ||
      arg.view.type === "timeGridDay"
    ) {
      setCurrentView(arg.view.type);
    }
    setPeriodLabel(arg.view.title);
  }

  const todayCount = useMemo(
    () => events.filter((event) => event.start.slice(0, 10) === todayIso).length,
    [events, todayIso]
  );

  return (
    <div className="jobs-admin-calendar space-y-4">
      <Card className="border-border/70 bg-surface">
        <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold">
                {events.length} {events.length === 1 ? "job" : "jobs"} loaded
              </span>
              <span className="text-muted-foreground">{todayCount} today</span>
              {(counts.UNASSIGNED ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                  {counts.UNASSIGNED} unassigned
                </span>
              ) : null}
            </div>
            <Button type="button" size="sm" variant="outline" className="h-9 rounded-full" onClick={loadJobs}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Status legend doubles as a filter — click to focus a status. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                statusFilter === "ALL"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground"
              }`}
            >
              All ({events.length})
            </button>
            {Object.entries(STATUS_META).map(([status, meta]) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter((current) => (current === status ? "ALL" : status))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  statusFilter === status
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `hsl(var(--${meta.variant}))` }} aria-hidden />
                {meta.label} ({counts[status] ?? 0})
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="relative overflow-hidden rounded-[calc(var(--radius)+6px)] border border-border bg-surface shadow-sm">
        {/* Polished, responsive toolbar. */}
        <div className="flex flex-col gap-3 border-b border-border bg-surface-raised/60 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-border bg-surface">
              <button
                type="button"
                onClick={() => calendarRef.current?.getApi().prev()}
                aria-label="Previous"
                className="flex h-9 w-9 items-center justify-center rounded-l-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => calendarRef.current?.getApi().next()}
                aria-label="Next"
                className="flex h-9 w-9 items-center justify-center rounded-r-full border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 rounded-full"
              onClick={() => calendarRef.current?.getApi().today()}
            >
              Today
            </Button>
            <p className="truncate text-sm font-semibold sm:text-base">{periodLabel}</p>
          </div>

          <div className="inline-flex w-full shrink-0 rounded-full border border-border bg-surface p-0.5 sm:w-auto">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setAgendaMode(false);
                  changeView(option.value);
                }}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4 ${
                  !agendaMode && currentView === option.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAgendaMode(true)}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4 ${
                agendaMode
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Agenda
            </button>
          </div>
        </div>

        {undoState ? (
          <div className="border-b border-border bg-warning/15 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-foreground">Schedule moved. You can undo this change for the next 5 seconds.</p>
              <Button type="button" size="sm" variant="outline" onClick={undoCalendarMove}>
                <Undo2 className="mr-2 h-4 w-4" />
                Undo
              </Button>
            </div>
          </div>
        ) : null}

        {agendaMode ? (
          <div className="divide-y divide-border">
            {agendaGroups.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No upcoming jobs.</p>
            ) : (
              agendaGroups.map(([day, dayEvents]) => (
                <div key={day}>
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-surface-raised/80 px-4 py-2 backdrop-blur">
                    <span className="text-sm font-semibold">
                      {new Date(`${day}T00:00:00`).toLocaleDateString("en-AU", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        timeZone: SYDNEY_TZ,
                      })}
                      {day === todayIso ? " · Today" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dayEvents.length} {dayEvents.length === 1 ? "job" : "jobs"}
                    </span>
                  </div>
                  {dayEvents.map((event) => {
                    const details = event.extendedProps;
                    const meta = STATUS_META[details.status] ?? STATUS_META.ASSIGNED;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => router.push(`/admin/jobs/${event.id}`)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <span
                          className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: `hsl(var(--${meta.variant}))` }}
                          aria-hidden
                        />
                        <span className="w-16 shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                          {details.startTime || "—"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{details.propertyName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {details.jobTypeLabel}
                            {details.suburb ? ` · ${details.suburb}` : ""}
                            {details.cleanerName ? ` · ${details.cleanerName}` : " · Unassigned"}
                          </span>
                        </span>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: `hsl(var(--${meta.variant}) / 0.15)`,
                            color: `hsl(var(--${meta.variant}))`,
                          }}
                        >
                          {meta.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        ) : (
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={isCompactViewport ? "timeGridDay" : "dayGridMonth"}
          headerToolbar={false}
          events={visibleEvents}
          eventContent={renderEventContent}
          eventClick={({ event }) => router.push(`/admin/jobs/${event.id}`)}
          editable
          eventDrop={handleEventMove}
          eventResize={handleEventMove}
          datesSet={handleDatesSet}
          height="auto"
          stickyHeaderDates
          dayMaxEventRows={isCompactViewport ? 3 : 4}
          moreLinkClick="popover"
          fixedWeekCount={false}
          eventOrder="start,-duration,title"
          nowIndicator
          timeZone="Australia/Sydney"
          eventTimeFormat={
            isCompactViewport
              ? { hour: "numeric", meridiem: "short" }
              : { hour: "numeric", minute: "2-digit", meridiem: "short" }
          }
          slotLabelFormat={
            isCompactViewport
              ? { hour: "numeric", meridiem: "short" }
              : { hour: "numeric", minute: "2-digit", meridiem: "short" }
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
              `${details.propertyName} | ${details.jobTypeLabel}${details.cleanerName ? ` | ${details.cleanerName}` : " | Unassigned"}${details.suburb ? ` | ${details.suburb}` : ""}`
            );
          }}
        />
        )}
      </div>

      <style jsx global>{`
        .jobs-admin-calendar .fc {
          position: relative;
          z-index: 0;
        }
        .jobs-admin-calendar .fc .fc-col-header-cell-cushion,
        .jobs-admin-calendar .fc .fc-daygrid-day-number {
          font-weight: 600;
          padding: 0.55rem 0.35rem;
        }
        .jobs-admin-calendar .fc .sneek-calendar-event {
          border-width: 1px;
          border-radius: 14px;
          padding: 0.3rem 0.4rem;
          transition: transform 140ms ease, box-shadow 140ms ease;
        }
        .jobs-admin-calendar .fc .sneek-calendar-event:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px -10px hsl(var(--foreground) / 0.45);
        }
        .jobs-admin-calendar .fc .sneek-calendar-event:active {
          transform: translateY(0);
        }
        .jobs-admin-calendar .fc .fc-daygrid-event-harness {
          margin-top: 0.22rem;
        }
        .jobs-admin-calendar .fc .fc-daygrid-event {
          min-height: 1.75rem;
        }
        .jobs-admin-calendar .fc .fc-daygrid-day-events {
          margin: 0 0.2rem 0.25rem;
        }
        .jobs-admin-calendar .fc .fc-daygrid-more-link {
          margin: 0.18rem 0.3rem 0.25rem;
          font-size: 0.72rem;
          font-weight: 600;
        }
        .jobs-admin-calendar .fc .fc-event-main {
          padding: 0;
        }
        .jobs-admin-calendar .fc .fc-popover {
          z-index: 40;
          border-radius: 16px;
          opacity: 1;
          overflow: hidden;
        }
        .jobs-admin-calendar .fc .fc-popover-header {
          padding: 0.7rem 0.9rem;
        }
        .jobs-admin-calendar .fc .fc-more-popover .fc-popover-body {
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
          border-left: 0;
          border-right: 0;
          border-bottom: 0;
        }
        .jobs-admin-calendar .fc .fc-timegrid-slot-label-cushion,
        .jobs-admin-calendar .fc .fc-timegrid-axis-cushion {
          font-size: 0.8rem;
          font-weight: 600;
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
        @media (max-width: 768px) {
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
            height: 2.6rem;
          }
          .jobs-admin-calendar .fc .fc-timegrid-event {
            min-height: 66px;
          }
        }
      `}</style>
    </div>
  );
}
