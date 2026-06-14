"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventContentArg } from "@fullcalendar/core";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, User2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CleanerJobOfferActions } from "@/components/cleaner/job-offer-actions";

type CalendarViewPreference = "dayGridMonth" | "timeGridWeek" | "timeGridDay";

const CALENDAR_VIEW_OPTIONS: Array<{ value: CalendarViewPreference; label: string; short: string }> = [
  { value: "dayGridMonth", label: "Month", short: "M" },
  { value: "timeGridWeek", label: "Week", short: "W" },
  { value: "timeGridDay", label: "Day", short: "D" },
];

export type PortalCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor?: string;
  extendedProps: {
    badgeLabel: string;
    subtitle?: string;
    meta?: string;
    cleanerName?: string;
    href?: string;
    assignmentResponseStatus?: string | null;
  };
};

type PortalCalendarLegendItem = {
  label: string;
  color: string;
};

type PortalCalendarSelectedEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  badgeLabel: string;
  subtitle?: string;
  meta?: string;
  cleanerName?: string;
  href?: string;
  assignmentResponseStatus?: string | null;
};

export function PortalCalendar({
  title,
  description,
  events,
  legendItems = [],
  emptyMessage = "No calendar items available.",
  viewPreferenceKey,
}: {
  title: string;
  description: string;
  events: PortalCalendarEvent[];
  legendItems?: PortalCalendarLegendItem[];
  emptyMessage?: string;
  viewPreferenceKey?: string;
}) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<PortalCalendarSelectedEvent | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [currentView, setCurrentView] = useState<CalendarViewPreference>("dayGridMonth");
  const [periodLabel, setPeriodLabel] = useState("");
  // Tracks whether the user explicitly picked a view this session, so we don't
  // stomp their choice when the viewport flips between mobile/desktop.
  const explicitViewRef = useRef(false);

  const legendCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, event) => {
      const key = event.extendedProps.badgeLabel;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }, [events]);

  // Restore a saved desktop view preference (mobile always opens on Day).
  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const compact = media.matches;
    setIsCompactViewport(compact);

    let initial: CalendarViewPreference = compact ? "timeGridDay" : "dayGridMonth";
    if (!compact && viewPreferenceKey) {
      try {
        const raw = window.localStorage.getItem(viewPreferenceKey);
        if (raw === "dayGridMonth" || raw === "timeGridWeek" || raw === "timeGridDay") {
          initial = raw;
        }
      } catch {
        // Ignore storage failures.
      }
    }
    setCurrentView(initial);
    const api = calendarRef.current?.getApi();
    if (api && api.view.type !== initial) api.changeView(initial);

    const syncViewport = (event: MediaQueryListEvent) => {
      setIsCompactViewport(event.matches);
      if (explicitViewRef.current) return;
      const next: CalendarViewPreference = event.matches ? "timeGridDay" : "dayGridMonth";
      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi && calendarApi.view.type !== next) calendarApi.changeView(next);
    };
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, [viewPreferenceKey]);

  function changeView(view: CalendarViewPreference) {
    explicitViewRef.current = true;
    const api = calendarRef.current?.getApi();
    if (api) api.changeView(view);
    setCurrentView(view);
    if (viewPreferenceKey && !isCompactViewport) {
      try {
        window.localStorage.setItem(viewPreferenceKey, view);
      } catch {
        // Ignore storage failures.
      }
    }
  }

  function dotStyle(borderColor?: string | null): CSSProperties {
    return { backgroundColor: borderColor ?? "hsl(var(--primary))" };
  }

  // Compact status + cleaner row shared across views. The cleaner name is the
  // owner-priority field, so it is always rendered when present (with a person
  // glyph so it reads at a glance on mobile).
  function CleanerLine({ name, className = "" }: { name?: string; className?: string }) {
    if (!name) return null;
    return (
      <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
        <User2 className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{name}</span>
      </span>
    );
  }

  function renderEventContent(arg: EventContentArg) {
    const details = arg.event.extendedProps as PortalCalendarEvent["extendedProps"];
    const isMonthView = arg.view.type === "dayGridMonth";
    const isTimeGridView = arg.view.type.startsWith("timeGrid");

    if (isMonthView) {
      return (
        <div className="flex min-w-0 flex-col gap-0.5 py-px">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={dotStyle(arg.event.borderColor)} />
            {arg.timeText ? (
              <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{arg.timeText}</span>
            ) : null}
            <span className="truncate text-[11px] font-semibold text-foreground">{arg.event.title}</span>
          </div>
          {details.cleanerName ? (
            <CleanerLine name={details.cleanerName} className="text-[10px] text-muted-foreground" />
          ) : null}
        </div>
      );
    }

    if (isTimeGridView) {
      return (
        <div className="flex h-full min-w-0 flex-col gap-1 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {details.badgeLabel}
            </span>
            {arg.timeText ? (
              <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{arg.timeText}</span>
            ) : null}
          </div>
          <div className="line-clamp-2 text-[11px] font-semibold leading-4 text-foreground sm:text-[12px]">
            {arg.event.title}
          </div>
          {details.cleanerName ? (
            <CleanerLine
              name={details.cleanerName}
              className="text-[10px] font-medium leading-4 text-foreground/90"
            />
          ) : null}
          <div className="truncate text-[10px] leading-4 text-muted-foreground">
            {[details.subtitle, details.meta].filter(Boolean).join(" · ")}
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {details.badgeLabel}
          </span>
          {arg.timeText ? <span className="shrink-0 text-[11px] text-muted-foreground">{arg.timeText}</span> : null}
        </div>
        <div className="truncate text-xs font-semibold text-foreground sm:text-[13px]">{arg.event.title}</div>
        {details.cleanerName ? (
          <CleanerLine name={details.cleanerName} className="text-[11px] font-medium text-foreground/90" />
        ) : null}
        {details.subtitle ? <div className="truncate text-[11px] text-muted-foreground">{details.subtitle}</div> : null}
        {details.meta ? <div className="truncate text-[11px] text-muted-foreground/80">{details.meta}</div> : null}
      </div>
    );
  }

  function openEventPreview(arg: EventClickArg) {
    const details = arg.event.extendedProps as PortalCalendarEvent["extendedProps"];
    setSelectedEvent({
      id: arg.event.id,
      title: arg.event.title,
      start: arg.event.startStr,
      end: arg.event.endStr ?? undefined,
      badgeLabel: details.badgeLabel,
      subtitle: details.subtitle,
      meta: details.meta,
      cleanerName: details.cleanerName,
      href: details.href,
      assignmentResponseStatus: details.assignmentResponseStatus,
    });
  }

  function handleEventClick(arg: EventClickArg) {
    const href = (arg.event.extendedProps as PortalCalendarEvent["extendedProps"]).href;
    const assignmentResponseStatus = (arg.event.extendedProps as PortalCalendarEvent["extendedProps"]).assignmentResponseStatus;
    if (isCompactViewport || !href || assignmentResponseStatus === "PENDING") {
      openEventPreview(arg);
      return;
    }
    if (href) router.push(href);
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

  function goPrev() {
    calendarRef.current?.getApi().prev();
  }
  function goNext() {
    calendarRef.current?.getApi().next();
  }
  function goToday() {
    calendarRef.current?.getApi().today();
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-surface">
        <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CalendarDays className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:text-sm">{description}</p>
              </div>
            </div>
            <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-xs font-medium text-muted-foreground">
              {events.length} {events.length === 1 ? "item" : "items"}
            </span>
          </div>

          {legendItems.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-3">
              {legendItems.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                  <span className="font-medium text-foreground/80">{item.label}</span>
                  <span className="tabular-nums">({legendCounts[item.label] ?? 0})</span>
                </span>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {events.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">{emptyMessage}</CardContent>
        </Card>
      ) : (
        <div className="sneek-portal-calendar relative overflow-hidden rounded-[calc(var(--radius)+6px)] border border-border bg-surface shadow-sm">
          {/* Custom toolbar — wraps and stacks cleanly on mobile, big tap targets. */}
          <div className="flex flex-col gap-3 border-b border-border bg-surface-raised/60 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded-full border border-border bg-surface">
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="Previous"
                  className="flex h-9 w-9 items-center justify-center rounded-l-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="Next"
                  className="flex h-9 w-9 items-center justify-center rounded-r-full border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-9 rounded-full" onClick={goToday}>
                Today
              </Button>
              <p className="truncate text-sm font-semibold sm:text-base">{periodLabel}</p>
            </div>

            <div className="inline-flex w-full shrink-0 rounded-full border border-border bg-surface p-0.5 sm:w-auto">
              {CALENDAR_VIEW_OPTIONS.map((option) => (
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
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={isCompactViewport ? "timeGridDay" : "dayGridMonth"}
            headerToolbar={false}
            events={events}
            eventContent={renderEventContent}
            eventClick={handleEventClick}
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
          />
        </div>
      )}

      <Dialog open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedEvent?.href ? (
                <Link href={selectedEvent.href} className="hover:underline">
                  {selectedEvent.title}
                </Link>
              ) : (
                selectedEvent?.title ?? "Calendar item"
              )}
            </DialogTitle>
            <DialogDescription>{selectedEvent?.badgeLabel ?? ""}</DialogDescription>
          </DialogHeader>
          {selectedEvent ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-2xl border border-border bg-muted/20 p-3">
                <p className="font-medium">
                  {selectedEvent.start
                    ? format(new Date(selectedEvent.start), "EEE dd MMM yyyy, h:mm a")
                    : "Time not set"}
                  {selectedEvent.end ? ` - ${format(new Date(selectedEvent.end), "h:mm a")}` : ""}
                </p>
                {selectedEvent.cleanerName ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-foreground">
                    <User2 className="h-3.5 w-3.5 opacity-70" aria-hidden />
                    {selectedEvent.cleanerName}
                  </p>
                ) : null}
                {selectedEvent.subtitle ? (
                  <p className="mt-1 text-muted-foreground">{selectedEvent.subtitle}</p>
                ) : null}
                {selectedEvent.meta ? <p className="mt-2 text-xs text-muted-foreground">{selectedEvent.meta}</p> : null}
              </div>
              {selectedEvent.href ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {selectedEvent.assignmentResponseStatus === "PENDING" ? (
                    <CleanerJobOfferActions
                      jobId={selectedEvent.id}
                      responseStatus={selectedEvent.assignmentResponseStatus}
                      compact
                      onCompleted={() => setSelectedEvent(null)}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    onClick={() => {
                      const href = selectedEvent.href;
                      setSelectedEvent(null);
                      if (href) router.push(href);
                    }}
                  >
                    Open details
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        /* Most theme-aware FullCalendar rules live in app/globals.css. This
           block only carries layout-specific overrides shared across portals. */
        .sneek-portal-calendar .fc .fc-col-header-cell-cushion,
        .sneek-portal-calendar .fc .fc-daygrid-day-number {
          font-weight: 600;
          padding: 0.55rem 0.35rem;
        }
        .sneek-portal-calendar .fc .fc-event {
          border-width: 1px;
          border-radius: 14px;
          padding: 0.2rem 0.4rem;
          cursor: pointer;
          transition: transform 140ms ease, box-shadow 140ms ease;
        }
        .sneek-portal-calendar .fc .fc-event:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px -10px hsl(var(--foreground) / 0.45);
        }
        .sneek-portal-calendar .fc .fc-event:active {
          transform: translateY(0);
        }
        .sneek-portal-calendar .fc .fc-daygrid-event {
          min-height: 1.75rem;
        }
        .sneek-portal-calendar .fc .fc-daygrid-day-events {
          margin: 0 0.2rem 0.25rem;
        }
        .sneek-portal-calendar .fc .fc-daygrid-more-link {
          margin: 0.18rem 0.3rem 0.25rem;
          font-size: 0.72rem;
          font-weight: 600;
        }
        .sneek-portal-calendar .fc .fc-popover {
          z-index: 40;
          border-radius: 16px;
          opacity: 1;
          overflow: hidden;
        }
        .sneek-portal-calendar .fc .fc-popover-header {
          padding: 0.7rem 0.9rem;
        }
        .sneek-portal-calendar .fc .fc-more-popover .fc-popover-body {
          padding: 0.45rem 0.55rem 0.65rem;
        }
        .sneek-portal-calendar .fc .fc-more-popover .fc-daygrid-event-harness,
        .sneek-portal-calendar .fc .fc-more-popover .fc-daygrid-event-harness-abs {
          position: relative !important;
          inset: auto !important;
          display: block !important;
          margin-top: 0.28rem !important;
        }
        .sneek-portal-calendar .fc .fc-more-popover .fc-daygrid-event {
          margin: 0 !important;
        }
        .sneek-portal-calendar .fc .fc-view-harness,
        .sneek-portal-calendar .fc .fc-view-harness-active {
          overflow: visible;
        }
        .sneek-portal-calendar .fc .fc-scrollgrid {
          border-left: 0;
          border-right: 0;
          border-bottom: 0;
        }
        .sneek-portal-calendar .fc .fc-event-main {
          padding: 0;
        }
        .sneek-portal-calendar .fc .fc-timegrid-slot-label-cushion,
        .sneek-portal-calendar .fc .fc-timegrid-axis-cushion {
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
        .sneek-portal-calendar .fc .fc-timegrid-axis {
          width: 4.3rem;
        }
        .sneek-portal-calendar .fc .fc-timegrid-axis-frame,
        .sneek-portal-calendar .fc .fc-timegrid-slot-label-frame {
          overflow: hidden;
        }
        .sneek-portal-calendar .fc .fc-timegrid-slot {
          height: 2.9rem;
        }
        .sneek-portal-calendar .fc .fc-timegrid-col-events {
          margin: 0 0.2rem;
        }
        .sneek-portal-calendar .fc .fc-timegrid-event {
          min-height: 76px;
          border-radius: 16px;
          padding: 0.24rem;
        }
        .sneek-portal-calendar .fc .fc-timegrid-event .fc-event-main {
          display: flex;
          height: 100%;
          align-items: stretch;
          padding: 0.12rem;
          overflow: hidden;
        }
        .sneek-portal-calendar .fc .fc-timegrid-event .fc-event-main > div {
          width: 100%;
          overflow: hidden;
        }
        .sneek-portal-calendar .fc .fc-timegrid-event .fc-event-title,
        .sneek-portal-calendar .fc .fc-timegrid-event .fc-event-time {
          white-space: normal;
        }
        .sneek-portal-calendar .fc .fc-timegrid-event-harness {
          margin-inline: 0.1rem;
        }
        @media (max-width: 768px) {
          .sneek-portal-calendar .fc .fc-timegrid-axis {
            width: 3rem;
          }
          .sneek-portal-calendar .fc .fc-timegrid-slot-label-cushion,
          .sneek-portal-calendar .fc .fc-timegrid-axis-cushion {
            font-size: 0.68rem;
            padding: 0 0.15rem;
          }
          .sneek-portal-calendar .fc .fc-daygrid-day-events {
            margin-inline: 0.1rem;
          }
          .sneek-portal-calendar .fc .fc-daygrid-more-link {
            margin-inline: 0.18rem;
          }
          .sneek-portal-calendar .fc .fc-timegrid-col-events {
            margin: 0 0.08rem;
          }
          .sneek-portal-calendar .fc .fc-timegrid-slot {
            height: 2.6rem;
          }
          .sneek-portal-calendar .fc .fc-timegrid-event {
            min-height: 66px;
          }
        }
      `}</style>
    </div>
  );
}
