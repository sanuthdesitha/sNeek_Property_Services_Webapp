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
import { Settings2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const CALENDAR_VIEW_OPTIONS: Array<{ value: CalendarViewPreference; label: string }> = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
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
  const [savedView, setSavedView] = useState<CalendarViewPreference>("dayGridMonth");
  const [draftView, setDraftView] = useState<CalendarViewPreference>("dayGridMonth");
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);

  const summary = useMemo(() => {
    const uniqueDays = new Set(events.map((event) => String(event.start).slice(0, 10))).size;
    const awaitingConfirmation = events.filter(
      (event) => event.extendedProps.assignmentResponseStatus === "PENDING"
    ).length;
    return {
      total: events.length,
      activeDays: uniqueDays,
      awaitingConfirmation,
    };
  }, [events]);

  const legendCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, event) => {
      const key = event.extendedProps.badgeLabel;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }, [events]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const syncViewport = () => setIsCompactViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!viewPreferenceKey) return;
    try {
      const raw = window.localStorage.getItem(viewPreferenceKey);
      if (
        raw === "dayGridMonth" ||
        raw === "timeGridWeek" ||
        raw === "timeGridDay"
      ) {
        setSavedView(raw);
        setDraftView(raw);
        setCurrentView(raw);
        const api = calendarRef.current?.getApi();
        if (api && api.view.type !== raw) {
          api.changeView(raw);
        }
      }
    } catch {
      // Ignore storage failures.
    }
  }, [viewPreferenceKey]);

  function getEventTextPalette(backgroundColor?: string | null, borderColor?: string | null) {
    if (!backgroundColor) {
      return {
        primary: "text-slate-900",
        secondary: "text-slate-600",
        tertiary: "text-slate-500",
        dot: "bg-slate-500",
        dotStyle: undefined as CSSProperties | undefined,
        pill: "bg-slate-100 text-slate-700",
      };
    }

    const value = backgroundColor.replace(/\s+/g, "").toLowerCase();
    const isLightRgba = value.startsWith("rgba(") || value.startsWith("hsla(");

    if (isLightRgba) {
      return {
        primary: "text-slate-900",
        secondary: "text-slate-600",
        tertiary: "text-slate-500",
        dot: "bg-current",
        dotStyle: { backgroundColor: borderColor ?? "#64748b" } as CSSProperties,
        pill: "bg-white/90 text-slate-700",
      };
    }

    return {
      primary: "text-white",
      secondary: "text-white/80",
      tertiary: "text-white/70",
      dot: "bg-white/85",
      dotStyle: undefined as CSSProperties | undefined,
      pill: "bg-white/20 text-white",
    };
  }

  function renderEventContent(arg: EventContentArg) {
    const details = arg.event.extendedProps as PortalCalendarEvent["extendedProps"];
    const isMonthView = arg.view.type === "dayGridMonth";
    const isDayView = arg.view.type === "timeGridDay";
    const isTimeGridView = arg.view.type.startsWith("timeGrid");
    const palette = getEventTextPalette(arg.event.backgroundColor, arg.event.borderColor);

    if (isMonthView) {
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${palette.dot}`} style={palette.dotStyle} />
          {arg.timeText ? (
            <span className={`shrink-0 text-[10px] font-semibold ${palette.secondary}`}>{arg.timeText}</span>
          ) : null}
          <span className={`truncate text-[11px] font-semibold ${palette.primary}`}>{arg.event.title}</span>
        </div>
      );
    }

    if (isTimeGridView) {
      return (
        <div className="flex h-full min-w-0 flex-col gap-1 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[10px] font-semibold uppercase tracking-[0.08em] ${palette.secondary}`}>
              {details.badgeLabel}
            </span>
            {arg.timeText ? (
              <span className={`shrink-0 text-[10px] font-semibold ${palette.secondary}`}>{arg.timeText}</span>
            ) : null}
          </div>
          <div className={`line-clamp-2 text-[11px] font-semibold leading-4 sm:text-[12px] ${palette.primary}`}>
            {arg.event.title}
          </div>
          {isDayView ? (
            <>
              {details.subtitle ? (
                <div className={`truncate text-[10px] leading-4 ${palette.secondary}`}>{details.subtitle}</div>
              ) : null}
              {details.meta ? (
                <div className={`line-clamp-2 text-[10px] leading-4 ${palette.tertiary}`}>{details.meta}</div>
              ) : null}
            </>
          ) : (
            <div className={`truncate text-[10px] leading-4 ${palette.secondary}`}>
              {[details.subtitle, details.meta].filter(Boolean).join(" | ")}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className={`truncate text-[11px] font-semibold uppercase tracking-[0.12em] ${palette.secondary}`}>
            {details.badgeLabel}
          </span>
          {arg.timeText ? (
            <span className={`shrink-0 text-[11px] ${palette.secondary}`}>{arg.timeText}</span>
          ) : null}
        </div>
        <div className={`truncate text-xs font-semibold sm:text-[13px] ${palette.primary}`}>{arg.event.title}</div>
        {details.subtitle ? (
          <div className={`truncate text-[11px] ${palette.secondary}`}>{details.subtitle}</div>
        ) : null}
        {details.meta ? <div className={`truncate text-[11px] ${palette.tertiary}`}>{details.meta}</div> : null}
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
  }

  function saveViewPreference() {
    if (!viewPreferenceKey) return;
    try {
      window.localStorage.setItem(viewPreferenceKey, draftView);
      setSavedView(draftView);
    } catch {
      // Ignore storage failures.
    }
    const api = calendarRef.current?.getApi();
    if (api && api.view.type !== draftView) {
      api.changeView(draftView);
    }
    setViewOptionsOpen(false);
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/15">
        <CardContent
          className={`grid gap-4 p-4 sm:p-5 ${legendItems.length > 0 ? "xl:grid-cols-[1.05fr_0.55fr_0.6fr]" : "sm:grid-cols-[1.2fr_0.8fr]"}`}
        >
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
              </div>
              {viewPreferenceKey ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setDraftView(currentView);
                    setViewOptionsOpen(true);
                  }}
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  View options
                </Button>
              ) : null}
            </div>
            {isCompactViewport ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Tap any job dot or event to open a detail popup without leaving the calendar.
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
              <p className="text-xs text-muted-foreground">Calendar items</p>
              <p className="text-2xl font-semibold">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
              <p className="text-xs text-muted-foreground">Active days</p>
              <p className="text-2xl font-semibold">{summary.activeDays}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
              <p className="text-xs text-muted-foreground">Awaiting confirmation</p>
              <p className="text-2xl font-semibold">{summary.awaitingConfirmation}</p>
            </div>
            {viewPreferenceKey ? (
              <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
                <p className="text-xs text-muted-foreground">Saved default view</p>
                <p className="text-base font-semibold">
                  {CALENDAR_VIEW_OPTIONS.find((option) => option.value === savedView)?.label ?? "Month"}
                </p>
              </div>
            ) : null}
          </div>
          {legendItems.length > 0 ? (
            <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
              <p className="text-xs text-muted-foreground">Legend</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {legendItems.map((item) => (
                  <Badge key={item.label} variant="outline" className="gap-1.5 bg-white/85">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                    {item.label} ({legendCounts[item.label] ?? 0})
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {events.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</CardContent>
        </Card>
      ) : (
        <div className="relative overflow-visible rounded-[calc(var(--radius)+6px)] border border-white/70 bg-white/80 shadow-sm">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={savedView}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day" }}
            events={events}
            eventContent={renderEventContent}
            eventClick={handleEventClick}
            datesSet={handleDatesSet}
            height="auto"
            stickyHeaderDates
            dayMaxEventRows={4}
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
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                <p className="font-medium">
                  {selectedEvent.start
                    ? format(new Date(selectedEvent.start), "EEE dd MMM yyyy, h:mm a")
                    : "Time not set"}
                  {selectedEvent.end ? ` - ${format(new Date(selectedEvent.end), "h:mm a")}` : ""}
                </p>
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
                    Open job
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={viewOptionsOpen} onOpenChange={setViewOptionsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Calendar View Options</DialogTitle>
            <DialogDescription>Choose the view that should open by default next time.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Default view</label>
              <select
                value={draftView}
                onChange={(event) => setDraftView(event.target.value as CalendarViewPreference)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CALENDAR_VIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
              Current calendar view:{" "}
              <span className="font-medium text-foreground">
                {CALENDAR_VIEW_OPTIONS.find((option) => option.value === currentView)?.label ?? "Month"}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setViewOptionsOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={saveViewPreference}>
                Save default view
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
          font-size: 1rem;
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
        .fc .fc-col-header-cell-cushion,
        .fc .fc-daygrid-day-number {
          color: #334155;
          font-weight: 600;
          padding: 0.55rem 0.35rem;
        }
        .fc .fc-event {
          border-width: 1px;
          border-radius: 14px;
          padding: 0.2rem 0.35rem;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
          cursor: pointer;
        }
        .fc .fc-daygrid-event {
          min-height: 1.55rem;
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
        .fc .fc-event-main {
          padding: 0;
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


