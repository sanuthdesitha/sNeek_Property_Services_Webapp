"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DatesSetArg, EventClickArg, EventContentArg } from "@fullcalendar/core";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

const SYDNEY_TZ = "Australia/Sydney";

type LaundryViewPreference = "dayGridMonth" | "dayGridWeek" | "dayGridDay";

const VIEW_OPTIONS: Array<{ value: LaundryViewPreference; label: string }> = [
  { value: "dayGridMonth", label: "Month" },
  { value: "dayGridWeek", label: "Week" },
  { value: "dayGridDay", label: "Day" },
];

// Token-based per-status palette so events read clean in both light and dark mode.
const STATUS_META: Record<
  string,
  { variant: "muted" | "primary" | "info" | "success" | "danger" | "warning"; label: string }
> = {
  PENDING: { variant: "muted", label: "Pending" },
  CONFIRMED: { variant: "primary", label: "Confirmed" },
  PICKED_UP: { variant: "info", label: "Picked up" },
  DROPPED: { variant: "success", label: "Completed" },
  FLAGGED: { variant: "danger", label: "Flagged" },
  SKIPPED_PICKUP: { variant: "warning", label: "Skipped pickup" },
};

type LaundryCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  classNames: string[];
  extendedProps: {
    status: string;
    suburb: string;
    clientName: string;
    pickupDate: string;
    dropoffDate: string;
    flagReason: string | null;
  };
};

function isoDate(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

function addOneDayIso(value: string | Date) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function shortDate(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-AU", { timeZone: SYDNEY_TZ, day: "numeric", month: "short" }).format(
    new Date(`${value}T00:00:00`)
  );
}

export default function LaundryCalendarView() {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [events, setEvents] = useState<LaundryCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<LaundryViewPreference>("dayGridMonth");
  const [periodLabel, setPeriodLabel] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const explicitViewRef = useRef(false);

  async function loadRange(start: string, end: string) {
    setLoading(true);
    const params = new URLSearchParams({ start, end });
    const res = await fetch(`/api/admin/laundry/calendar?${params.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => []);
    const nextEvents = Array.isArray(data)
      ? data.map((task: any) => {
          const meta = STATUS_META[String(task.status)] ?? STATUS_META.PENDING;
          return {
            id: task.id,
            title: task?.property?.name ?? "Laundry task",
            start: isoDate(task.pickupDate),
            end: addOneDayIso(task.dropoffDate),
            allDay: true,
            backgroundColor: `hsl(var(--${meta.variant}) / 0.18)`,
            borderColor: `hsl(var(--${meta.variant}) / 0.55)`,
            textColor: "hsl(var(--foreground))",
            classNames: ["sneek-calendar-event", `status-${String(task.status).toLowerCase()}`],
            extendedProps: {
              status: String(task.status),
              suburb: String(task?.property?.suburb ?? ""),
              clientName: String(task?.property?.client?.name ?? ""),
              pickupDate: isoDate(task.pickupDate),
              dropoffDate: isoDate(task.dropoffDate),
              flagReason: task?.flagReason ?? null,
            },
          } satisfies LaundryCalendarEvent;
        })
      : [];
    setEvents(nextEvents);
    setLoading(false);
  }

  function refreshRange() {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    void loadRange(api.view.activeStart.toISOString(), api.view.activeEnd.toISOString());
  }

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    void loadRange(api.view.activeStart.toISOString(), api.view.activeEnd.toISOString());
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const compact = media.matches;
    setIsCompactViewport(compact);
    const initial: LaundryViewPreference = compact ? "dayGridDay" : "dayGridMonth";
    setCurrentView(initial);
    const api = calendarRef.current?.getApi();
    if (api && api.view.type !== initial) api.changeView(initial);

    const sync = (event: MediaQueryListEvent) => {
      setIsCompactViewport(event.matches);
      if (explicitViewRef.current) return;
      const next: LaundryViewPreference = event.matches ? "dayGridDay" : "dayGridMonth";
      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi && calendarApi.view.type !== next) calendarApi.changeView(next);
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const counts = useMemo(
    () =>
      events.reduce<Record<string, number>>((acc, event) => {
        const status = event.extendedProps.status;
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      }, {}),
    [events]
  );

  const visibleEvents = useMemo(
    () => (statusFilter === "ALL" ? events : events.filter((event) => event.extendedProps.status === statusFilter)),
    [events, statusFilter]
  );

  function handleDatesSet(arg: DatesSetArg) {
    if (arg.view.type === "dayGridMonth" || arg.view.type === "dayGridWeek" || arg.view.type === "dayGridDay") {
      setCurrentView(arg.view.type);
    }
    setPeriodLabel(arg.view.title);
    void loadRange(arg.start.toISOString(), arg.end.toISOString());
  }

  function handleEventClick(arg: EventClickArg) {
    router.push(`/admin/laundry?taskId=${arg.event.id}`);
  }

  function changeView(view: LaundryViewPreference) {
    explicitViewRef.current = true;
    const api = calendarRef.current?.getApi();
    if (api) api.changeView(view);
    setCurrentView(view);
  }

  function renderEventContent(arg: EventContentArg) {
    const status = String(arg.event.extendedProps.status ?? "");
    const meta = STATUS_META[status] ?? STATUS_META.PENDING;
    const suburb = String(arg.event.extendedProps.suburb ?? "");
    const clientName = String(arg.event.extendedProps.clientName ?? "");
    const pickupDate = String(arg.event.extendedProps.pickupDate ?? "");
    const dropoffDate = String(arg.event.extendedProps.dropoffDate ?? "");
    const flagReason = String(arg.event.extendedProps.flagReason ?? "");
    const isMonthView = arg.view.type === "dayGridMonth";

    if (isMonthView) {
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(var(--${meta.variant}))` }} />
            <span className="truncate text-[11px] font-semibold text-foreground">{arg.event.title}</span>
            {flagReason ? (
              <span className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
                Issue
              </span>
            ) : null}
          </div>
          <span className="truncate text-[10px] text-muted-foreground">
            {shortDate(pickupDate)} → {shortDate(dropoffDate)}
          </span>
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-col gap-1 px-0.5 py-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {meta.label}
          </span>
          {flagReason ? (
            <span className="shrink-0 rounded-full bg-danger/15 px-1.5 py-0.5 text-[9px] font-semibold text-danger">
              Issue
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs font-semibold text-foreground sm:text-[13px]">{arg.event.title}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {clientName || "Laundry schedule"}
          {suburb ? ` · ${suburb}` : ""}
        </div>
        <div className="truncate text-[11px] text-muted-foreground/80">
          Pickup {shortDate(pickupDate)} · Drop-off {shortDate(dropoffDate)}
        </div>
        {flagReason ? (
          <div className="truncate text-[11px] text-danger/90">Issue: {flagReason.replace(/_/g, " ")}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="laundry-admin-calendar space-y-4">
      <Card className="border-border/70 bg-surface">
        <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold">
                {events.length} {events.length === 1 ? "task" : "tasks"} loaded
              </span>
              {(counts.FLAGGED ?? 0) + (counts.SKIPPED_PICKUP ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-semibold text-danger">
                  {(counts.FLAGGED ?? 0) + (counts.SKIPPED_PICKUP ?? 0)} need attention
                </span>
              ) : null}
            </div>
            <Button type="button" size="sm" variant="outline" className="h-9 rounded-full" onClick={refreshRange}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Status legend doubles as a filter. */}
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
                onClick={() => changeView(option.value)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4 ${
                  currentView === option.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView={isCompactViewport ? "dayGridDay" : "dayGridMonth"}
          headerToolbar={false}
          height="auto"
          events={visibleEvents}
          eventContent={renderEventContent}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          stickyHeaderDates
          dayMaxEventRows={isCompactViewport ? 3 : 4}
          moreLinkClick="popover"
          fixedWeekCount={false}
          eventOrder="start,-duration,title"
          nowIndicator
          timeZone="Australia/Sydney"
          eventDidMount={(info) => {
            const details = info.event.extendedProps as LaundryCalendarEvent["extendedProps"];
            info.el.setAttribute(
              "title",
              `${info.event.title}${details.clientName ? ` | ${details.clientName}` : ""}${details.suburb ? ` | ${details.suburb}` : ""}`
            );
          }}
        />
      </div>

      <style jsx global>{`
        .laundry-admin-calendar .fc {
          position: relative;
          z-index: 0;
        }
        .laundry-admin-calendar .fc .fc-col-header-cell-cushion,
        .laundry-admin-calendar .fc .fc-daygrid-day-number {
          font-weight: 600;
          padding: 0.55rem 0.35rem;
        }
        .laundry-admin-calendar .fc .sneek-calendar-event {
          border-width: 1px;
          border-radius: 14px;
          padding: 0.3rem 0.4rem;
          transition: transform 140ms ease, box-shadow 140ms ease;
        }
        .laundry-admin-calendar .fc .sneek-calendar-event:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px -10px hsl(var(--foreground) / 0.45);
        }
        .laundry-admin-calendar .fc .sneek-calendar-event:active {
          transform: translateY(0);
        }
        .laundry-admin-calendar .fc .fc-daygrid-event-harness {
          margin-top: 0.22rem;
        }
        .laundry-admin-calendar .fc .fc-daygrid-event {
          min-height: 1.75rem;
        }
        .laundry-admin-calendar .fc .fc-daygrid-day-events {
          margin: 0 0.2rem 0.25rem;
        }
        .laundry-admin-calendar .fc .fc-daygrid-more-link {
          margin: 0.18rem 0.3rem 0.25rem;
          font-size: 0.72rem;
          font-weight: 600;
        }
        .laundry-admin-calendar .fc .fc-event-main {
          padding: 0;
        }
        .laundry-admin-calendar .fc .fc-popover {
          z-index: 40;
          border-radius: 16px;
          opacity: 1;
          overflow: hidden;
        }
        .laundry-admin-calendar .fc .fc-popover-header {
          padding: 0.7rem 0.9rem;
        }
        .laundry-admin-calendar .fc .fc-more-popover .fc-popover-body {
          padding: 0.45rem 0.55rem 0.65rem;
        }
        .laundry-admin-calendar .fc .fc-more-popover .fc-daygrid-event-harness,
        .laundry-admin-calendar .fc .fc-more-popover .fc-daygrid-event-harness-abs {
          position: relative !important;
          inset: auto !important;
          display: block !important;
          margin-top: 0.28rem !important;
        }
        .laundry-admin-calendar .fc .fc-more-popover .fc-daygrid-event {
          margin: 0 !important;
        }
        .laundry-admin-calendar .fc .fc-view-harness,
        .laundry-admin-calendar .fc .fc-view-harness-active {
          overflow: visible;
        }
        .laundry-admin-calendar .fc .fc-scrollgrid {
          border-left: 0;
          border-right: 0;
          border-bottom: 0;
        }
        .laundry-admin-calendar .fc .fc-daygrid-day-frame {
          min-height: 7rem;
        }
        @media (max-width: 768px) {
          .laundry-admin-calendar .fc .fc-daygrid-day-events {
            margin-inline: 0.1rem;
          }
          .laundry-admin-calendar .fc .fc-daygrid-more-link {
            margin-inline: 0.18rem;
          }
          .laundry-admin-calendar .fc .fc-daygrid-day-frame {
            min-height: 5.6rem;
          }
        }
      `}</style>
    </div>
  );
}
