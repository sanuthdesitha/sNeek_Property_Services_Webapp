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
import { CalendarClock, Clock3, MapPin, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

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

export default function CalendarView() {
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
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

  const summary = useMemo(
    () => [
      {
        label: "Total jobs",
        value: events.length,
        icon: CalendarClock,
      },
      {
        label: "Need assignment",
        value: counts.UNASSIGNED ?? 0,
        icon: MapPin,
      },
      {
        label: "In progress",
        value: counts.IN_PROGRESS ?? 0,
        icon: Clock3,
      },
    ],
    [counts, events.length]
  );

  function renderEventContent(arg: EventContentArg) {
    const details = arg.event.extendedProps as CalendarEvent["extendedProps"];
    const statusMeta = STATUS_META[details.status] ?? STATUS_META.ASSIGNED;
    const palette = getEventTextPalette(arg.event.backgroundColor);
    const isMonthView = arg.view.type === "dayGridMonth";
    const isDayView = arg.view.type === "timeGridDay";
    const isTimeGridView = arg.view.type.startsWith("timeGrid");

    if (isMonthView) {
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${palette.dotClass}`}
            style={palette.dotClass === "bg-current" ? { backgroundColor: statusMeta.color } : palette.dotStyle}
          />
          {arg.timeText ? (
            <span className={`shrink-0 text-[10px] font-semibold ${palette.secondary}`}>{arg.timeText}</span>
          ) : null}
          <span className={`truncate text-[11px] font-semibold ${palette.primary}`}>{details.propertyName}</span>
          {details.assignedCount > 1 ? (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${palette.pillClass}`}>
              +{details.assignedCount}
            </span>
          ) : null}
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
    <div className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-primary/15">
          <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Schedule Board
                </p>
                <h3 className="mt-1 text-lg font-semibold sm:text-xl">Jobs mapped by day, week, and shift</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use the month view to spot workload clusters, then switch to week/day for tighter dispatch planning.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-border/70 bg-white/80 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={loadJobs}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {summary.map((item) => (
                <div key={item.label} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10">
                      <item.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="text-xl font-semibold">{item.value}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Status Legend</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(STATUS_META).map(([status, meta]) => (
                <Badge key={status} variant={meta.badge}>
                  {meta.label} ({counts[status] ?? 0})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative overflow-visible rounded-[calc(var(--radius)+6px)] border border-white/70 bg-white/75 shadow-sm">
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
              `${details.propertyName} • ${details.jobTypeLabel}${details.suburb ? ` • ${details.suburb}` : ""}`
            );
          }}
        />
      </div>

      <style jsx global>{`
        .fc {
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

        .fc .fc-toolbar.fc-header-toolbar {
          margin-bottom: 1rem;
          padding: 1rem 1rem 0;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .fc .fc-toolbar-title {
          font-size: 1.05rem;
          font-weight: 700;
          color: #0f172a;
        }

        .fc .fc-button {
          border-radius: 9999px;
          box-shadow: none;
          font-weight: 600;
          padding: 0.45rem 0.85rem;
          color: #f8fafc;
        }

        .fc .fc-scrollgrid,
        .fc .fc-timegrid-slot,
        .fc .fc-timegrid-axis,
        .fc .fc-col-header-cell,
        .fc .fc-daygrid-day {
          border-color: rgba(148, 163, 184, 0.22);
        }

        .fc .fc-col-header-cell-cushion,
        .fc .fc-daygrid-day-number {
          color: #334155;
          font-weight: 600;
          padding: 0.55rem 0.35rem;
        }

        .fc .fc-day-today .fc-daygrid-day-number {
          color: #2563eb;
        }

        .fc .sneek-calendar-event {
          border-width: 1px;
          border-radius: 14px;
          padding: 0.3rem 0.4rem;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
        }

        .fc .fc-daygrid-event-harness {
          margin-top: 0.22rem;
        }

        .fc .fc-daygrid-event {
          min-height: 1.6rem;
        }

        .fc .fc-daygrid-day-events {
          margin: 0 0.2rem 0.25rem;
        }

        .fc .fc-daygrid-more-link {
          margin: 0.18rem 0.3rem 0.25rem;
          font-size: 0.72rem;
          font-weight: 600;
          color: #2563eb;
        }

        .fc .fc-event-main {
          padding: 0;
        }

        .fc .fc-popover {
          z-index: 40;
          background: #ffffff;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          opacity: 1;
          overflow: hidden;
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18);
        }

        .fc .fc-popover-header {
          padding: 0.7rem 0.9rem;
          background: #f8fafc;
        }

        .fc .fc-popover-title,
        .fc .fc-popover-close {
          color: #0f172a;
        }

        .fc .fc-more-popover .fc-popover-body {
          background: #ffffff;
          padding: 0.45rem 0.55rem 0.65rem;
        }

        .fc .fc-more-popover .fc-daygrid-event-harness,
        .fc .fc-more-popover .fc-daygrid-event-harness-abs {
          position: relative !important;
          inset: auto !important;
          display: block !important;
          margin-top: 0.28rem !important;
        }

        .fc .fc-more-popover .fc-daygrid-event {
          margin: 0 !important;
        }

        .fc .fc-view-harness,
        .fc .fc-view-harness-active {
          overflow: visible;
        }

        .fc .fc-scrollgrid {
          border-radius: calc(var(--radius) + 6px);
          overflow: hidden;
        }

        .fc .fc-timegrid-slot-label-cushion,
        .fc .fc-timegrid-axis-cushion {
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
        .fc .fc-timegrid-axis {
          width: 4.3rem;
        }
        .fc .fc-timegrid-axis-frame,
        .fc .fc-timegrid-slot-label-frame {
          overflow: hidden;
        }
        .fc .fc-timegrid-slot {
          height: 2.9rem;
        }

        .fc .fc-timegrid-col-events {
          margin: 0 0.2rem;
        }

        .fc .fc-timegrid-event {
          min-height: 76px;
          border-radius: 16px;
          padding: 0.24rem;
          box-shadow: 0 10px 24px -20px rgba(15, 23, 42, 0.5);
        }

        .fc .fc-timegrid-event .fc-event-main {
          display: flex;
          height: 100%;
          align-items: stretch;
          padding: 0.12rem;
          overflow: hidden;
        }

        .fc .fc-timegrid-event .fc-event-main > div {
          width: 100%;
          overflow: hidden;
        }

        .fc .fc-timegrid-event .fc-event-title,
        .fc .fc-timegrid-event .fc-event-time {
          white-space: normal;
        }

        .fc .fc-timegrid-event-harness {
          margin-inline: 0.1rem;
        }

        .fc .fc-timegrid-now-indicator-line {
          border-color: #ef4444;
        }

        .fc .fc-timegrid-now-indicator-arrow {
          border-top-color: #ef4444;
          border-bottom-color: #ef4444;
        }

        @media (max-width: 768px) {
          .fc .fc-toolbar.fc-header-toolbar {
            padding: 0.85rem 0.85rem 0;
          }

          .fc .fc-toolbar-title {
            font-size: 0.95rem;
          }

          .fc .fc-button {
            padding: 0.4rem 0.65rem;
            font-size: 0.75rem;
          }
          .fc .fc-toolbar-chunk {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
          }
          .fc .fc-timegrid-axis {
            width: 3rem;
          }
          .fc .fc-timegrid-slot-label-cushion,
          .fc .fc-timegrid-axis-cushion {
            font-size: 0.68rem;
            padding: 0 0.15rem;
          }

          .fc .fc-daygrid-day-events {
            margin-inline: 0.1rem;
          }

          .fc .fc-daygrid-more-link {
            margin-inline: 0.18rem;
          }

          .fc .fc-timegrid-col-events {
            margin: 0 0.08rem;
          }

          .fc .fc-timegrid-slot {
            height: 2.45rem;
          }

          .fc .fc-timegrid-event {
            min-height: 64px;
          }
        }
      `}</style>
    </div>
  );
}
